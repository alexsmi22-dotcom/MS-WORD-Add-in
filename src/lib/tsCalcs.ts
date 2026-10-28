/**
 * The three Release E3a Stats calculators (time-series diagnostics), as pure functions of the field reader so jest
 * can run them; the engines are lib/tsDiag.ts and every series goes through lib/tsData.ts (parseSeriesTable):
 *
 *  - ts-acf       correlogram: ACF and PACF with 95% bands, Ljung–Box Q per lag, a two-panel figure;
 *  - ts-unitroot  ADF and KPSS side by side, with a table reading the pair;
 *  - ts-hp        Hodrick–Prescott trend and cycle, λ by the data's frequency.
 *
 * Worked default: a synthetic quarterly table, 1995 Q1 to 2024 Q4 (numpy default_rng(20261029), written by
 * scripts/ts-diag-oracle.py): "Output" is a random walk with drift (AR(1) innovations), "Spread" a stationary AR(1).
 * Synthetic, so it can ship; jest checks the oracle computed on exactly this text.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { parseSeriesTable, pickSeries, type SeriesDates } from "./tsData";
import { decimalYear } from "./damagesInterest";
import { fmtFixed, fmtP, intText, NBSP, P_BELOW } from "./regTable";
import { buildPlotSvg, combineSvgs, type Series } from "./plot";
import { fitReading } from "./statLibReading";
import {
  acfBiased,
  acfBands,
  pacfYwAdjusted,
  ljungBox,
  pacfDefaultLags,
  adfTest,
  adfDefaultMaxLag,
  adfLagCap,
  kpssTest,
  hpFilter,
  Z975,
  type AdfRegression,
  type KpssRegression,
} from "./tsDiag";

export const TS_DEFAULT = [
  "Quarter Output Spread",
  "1995-Q1 99.58 2.09", "1995-Q2 100.81 2.15", "1995-Q3 101.19 1.09", "1995-Q4 101.02 1.38",
  "1996-Q1 102.60 1.24", "1996-Q2 103.18 1.33", "1996-Q3 103.37 1.31", "1996-Q4 102.73 1.79",
  "1997-Q1 103.29 2.23", "1997-Q2 103.63 2.15", "1997-Q3 105.17 2.02", "1997-Q4 105.06 1.13",
  "1998-Q1 105.20 1.54", "1998-Q2 105.60 1.54", "1998-Q3 106.14 1.78", "1998-Q4 106.34 1.56",
  "1999-Q1 107.21 1.95", "1999-Q2 108.07 1.80", "1999-Q3 110.12 1.59", "1999-Q4 110.24 1.17",
  "2000-Q1 110.80 1.61", "2000-Q2 111.99 0.94", "2000-Q3 113.14 0.82", "2000-Q4 113.70 0.61",
  "2001-Q1 113.41 0.41", "2001-Q2 113.50 0.88", "2001-Q3 115.24 1.32", "2001-Q4 116.26 1.64",
  "2002-Q1 117.32 1.39", "2002-Q2 119.08 1.19", "2002-Q3 120.95 1.17", "2002-Q4 121.90 1.41",
  "2003-Q1 121.63 1.23", "2003-Q2 123.23 1.44", "2003-Q3 124.48 1.88", "2003-Q4 126.56 1.82",
  "2004-Q1 127.27 2.00", "2004-Q2 128.53 2.16", "2004-Q3 128.55 2.43", "2004-Q4 128.29 2.32",
  "2005-Q1 126.53 2.00", "2005-Q2 126.26 1.56", "2005-Q3 126.17 1.37", "2005-Q4 126.02 1.28",
  "2006-Q1 126.42 1.16", "2006-Q2 126.96 1.36", "2006-Q3 126.72 1.92", "2006-Q4 127.34 1.90",
  "2007-Q1 128.20 1.97", "2007-Q2 130.16 1.63", "2007-Q3 130.53 1.97", "2007-Q4 132.15 1.51",
  "2008-Q1 134.51 1.17", "2008-Q2 135.77 1.25", "2008-Q3 137.14 1.30", "2008-Q4 137.99 2.32",
  "2009-Q1 138.00 1.64", "2009-Q2 139.19 1.09", "2009-Q3 140.06 2.06", "2009-Q4 140.43 2.23",
  "2010-Q1 142.19 1.40", "2010-Q2 143.77 1.93", "2010-Q3 144.01 1.37", "2010-Q4 145.12 1.75",
  "2011-Q1 146.94 1.40", "2011-Q2 147.91 0.99", "2011-Q3 150.48 1.63", "2011-Q4 151.27 1.68",
  "2012-Q1 152.67 1.42", "2012-Q2 154.16 1.12", "2012-Q3 153.67 1.17", "2012-Q4 152.74 0.68",
  "2013-Q1 152.87 1.20", "2013-Q2 154.09 0.42", "2013-Q3 154.24 1.12", "2013-Q4 155.20 0.92",
  "2014-Q1 156.26 1.59", "2014-Q2 159.16 1.35", "2014-Q3 160.76 1.65", "2014-Q4 162.09 1.80",
  "2015-Q1 162.22 1.73", "2015-Q2 162.54 1.23", "2015-Q3 163.07 1.46", "2015-Q4 165.60 1.40",
  "2016-Q1 166.83 2.02", "2016-Q2 167.61 2.17", "2016-Q3 167.31 1.96", "2016-Q4 167.36 1.47",
  "2017-Q1 168.41 1.32", "2017-Q2 169.04 1.05", "2017-Q3 169.65 0.94", "2017-Q4 168.84 1.04",
  "2018-Q1 168.76 0.69", "2018-Q2 169.05 0.83", "2018-Q3 170.17 1.33", "2018-Q4 171.81 1.64",
  "2019-Q1 172.64 1.36", "2019-Q2 173.66 1.09", "2019-Q3 174.07 1.01", "2019-Q4 174.02 1.09",
  "2020-Q1 174.53 1.16", "2020-Q2 174.70 1.66", "2020-Q3 175.42 1.97", "2020-Q4 176.47 1.95",
  "2021-Q1 177.82 1.45", "2021-Q2 178.89 1.64", "2021-Q3 179.38 1.86", "2021-Q4 179.70 1.86",
  "2022-Q1 179.88 1.80", "2022-Q2 179.84 1.04", "2022-Q3 179.08 1.01", "2022-Q4 179.22 1.14",
  "2023-Q1 178.08 1.75", "2023-Q2 178.25 1.20", "2023-Q3 177.47 1.32", "2023-Q4 179.44 1.27",
  "2024-Q1 180.80 1.58", "2024-Q2 182.99 1.51", "2024-Q3 183.15 1.54", "2024-Q4 182.89 1.35",
].join("\n");

export interface TsField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  options?: { value: string; label: string }[];
}

const DATA_FIELD: TsField = {
  key: "data",
  label: "Series table: dates or periods in the first column (optional), then one or more value columns",
  default: TS_DEFAULT,
  kind: "block",
};

export const TS_ACF_FIELDS: TsField[] = [
  DATA_FIELD,
  { key: "series", label: "Column to analyse (blank when the table has one value column)", default: "Spread", kind: "text" },
  { key: "lags", label: "Lags (blank = min(⌊10·log₁₀ n⌋, n/2 − 1), statsmodels' default)", default: "", kind: "text" },
  { key: "modelDf", label: "Model degrees of freedom for Ljung–Box (0 for a raw series; p + q for ARIMA residuals)", default: "0", kind: "text" },
];

export const TS_UNITROOT_FIELDS: TsField[] = [
  DATA_FIELD,
  { key: "series", label: "Column to test (blank when the table has one value column)", default: "Output", kind: "text" },
  {
    key: "regression",
    label: "Deterministic terms",
    default: "c",
    kind: "select",
    options: [
      { value: "c", label: "Constant" },
      { value: "ct", label: "Constant + linear trend" },
      { value: "n", label: "None (ADF only; KPSS keeps a constant)" },
    ],
  },
  {
    key: "adfMode",
    label: "ADF lag",
    default: "aic",
    kind: "select",
    options: [
      { value: "aic", label: "Chosen by AIC (0 up to the maximum lag)" },
      { value: "fixed", label: "Fixed (exactly the lag below)" },
    ],
  },
  { key: "adfLag", label: "ADF maximum or fixed lag (blank = ⌈12·∜(n/100)⌉, Schwert)", default: "", kind: "text" },
  {
    key: "kpssMode",
    label: "KPSS lags",
    default: "auto",
    kind: "select",
    options: [
      { value: "auto", label: "Automatic (Hobijn, Franses & Ooms 1998)" },
      { value: "fixed", label: "Fixed (the number below)" },
    ],
  },
  { key: "kpssLags", label: "KPSS lags when fixed", default: "", kind: "text" },
];

export const TS_HP_FIELDS: TsField[] = [
  DATA_FIELD,
  { key: "series", label: "Column to filter (blank when the table has one value column)", default: "Output", kind: "text" },
  {
    key: "lambdaRule",
    label: "Smoothing λ",
    default: "standard",
    kind: "select",
    options: [
      { value: "standard", label: "By frequency, common values: quarterly 1,600, annual 100, monthly 14,400" },
      { value: "ru", label: "By frequency, Ravn–Uhlig (2002): quarterly 1,600, annual 6.25, monthly 129,600" },
      { value: "custom", label: "Custom λ (below)" },
    ],
  },
  { key: "lambda", label: "Custom λ", default: "1600", kind: "text" },
];

const defaultsOf = (fields: TsField[]): Record<string, string> => Object.fromEntries(fields.map((f) => [f.key, f.default]));
export const TS_ACF_DEFAULTS = defaultsOf(TS_ACF_FIELDS);
export const TS_UNITROOT_DEFAULTS = defaultsOf(TS_UNITROOT_FIELDS);
export const TS_HP_DEFAULTS = defaultsOf(TS_HP_FIELDS);

/** At most this many lags in the correlogram table and figure. */
export const ACF_MAX_LAGS = 200;
/** The HP table lists every row up to this many; beyond it the figure carries the series. */
export const HP_TABLE_MAX_ROWS = 500;
/** At most this many points per line in a figure (every m-th row beyond it, said in the text). */
export const TS_FIGURE_MAX_POINTS = 2000;
/** The largest custom λ accepted (the HP system's condition number grows like 16λ). */
export const HP_LAMBDA_MAX = 1e9;

type Read = (k: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;
/** U+2212, the true minus, read as "-" in number fields. */
const MINUS_RE = new RegExp(String.fromCharCode(0x2212), "g");

/** A whole-number field: blank → undefined; rubbish, negatives, fractions, 1e400 → a named error. */
function readWhole(raw: string, label: string, min: number, max: number): number | undefined | { error: string } {
  const s = (raw ?? "").trim();
  if (s === "") return undefined;
  const t = s.replace(MINUS_RE, "-");
  const v = /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
  if (!Number.isSafeInteger(v) || v < min || v > max) {
    return { error: `${label}: ${q(s)} is not a whole number from ${intText(min)} to ${intText(max)}.` };
  }
  return v;
}

/** A positive number field (λ): plain decimals, grouped thousands, U+2212 read as minus. */
function readPositive(raw: string, label: string, max: number): number | { error: string } {
  const s = (raw ?? "").trim();
  if (s === "") return { error: `${label}: enter a number.` };
  let t = s.replace(MINUS_RE, "-").replace(/\s/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  const v = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(v) || v <= 0 || v > max) return { error: `${label}: ${q(s)} is not a number above 0 and at most ${intText(max)}.` };
  return v;
}

interface ReadSeries {
  name: string;
  values: Float64Array;
  dates?: SeriesDates;
  notes: string[];
}

/** The series column, with a gap or a mix of periods refused by name (lags assume equally spaced rows). */
function readSeries(read: Read, minRows: number): ReadSeries | { error: string } {
  const parsed = parseSeriesTable(read("data") ?? "", { minRows });
  if (!parsed.ok) return { error: parsed.reason };
  const pick = pickSeries(parsed.data, read("series") ?? "");
  if (!pick.ok) return { error: pick.reason };
  const dates = parsed.data.dates;
  if (dates && dates.frequency === "irregular") {
    return {
      error: dates.gap
        ? `The dates have a gap (${dates.gap}). Lags and filters assume one row per period; fill the missing periods or remove the dates.`
        : "The dates mix kinds of period (years, quarters, months or days). Use one kind of period throughout, or remove the dates.",
    };
  }
  return { name: pick.name, values: pick.values, dates, notes: parsed.data.notes };
}

const FREQ_WORD: Record<string, string> = { year: "annual", quarter: "quarterly", month: "monthly", day: "daily" };

function spanLine(s: ReadSeries): string {
  const n = s.values.length;
  if (!s.dates) return `${intText(n)} observations, undated (rows taken as equally spaced).`;
  const t = s.dates.tokens;
  return `${intText(n)} ${FREQ_WORD[s.dates.frequency] ?? ""} observations, ${t[0].label} to ${t[t.length - 1].label}.`.replace("  ", " ");
}

/** x coordinates for a figure: decimal years when dated, else 1…n. */
function timeAxis(s: ReadSeries): { x: (i: number) => number; label: string } {
  if (s.dates) {
    const t = s.dates.tokens;
    return { x: (i) => decimalYear((t[i].from + t[i].to) / 2), label: "Year" };
  }
  return { x: (i) => i + 1, label: "Observation" };
}

function decimatedLine(n: number, x: (i: number) => number, y: (i: number) => number, step: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i += step) pts.push({ x: x(i), y: y(i) });
  if ((n - 1) % step !== 0) pts.push({ x: x(n - 1), y: y(n - 1) });
  return pts;
}

/** A finite-number guard over every value an ok result prints. */
function firstNonFinite(checks: [string, number][]): string | null {
  const hit = checks.find(([, v]) => !Number.isFinite(v));
  return hit ? hit[0] : null;
}

// --- ts-acf -----------------------------------------------------------------------------------------------------------

/** Correlogram and Ljung–Box. */
export function tsAcfCalc(read: Read): StatOutput {
  const s = readSeries(read, 10);
  if ("error" in s) return refuse(s.error);
  const n = s.values.length;
  const half = Math.floor(n / 2);
  const lagsIn = readWhole(read("lags"), "Lags", 1, Math.min(ACF_MAX_LAGS, half));
  if (typeof lagsIn === "object") {
    const why = half < ACF_MAX_LAGS ? ` The PACF can be computed for at most n/2 = ${half} lags (statsmodels' limit).` : "";
    return refuse(lagsIn.error + why);
  }
  const K = lagsIn ?? Math.min(pacfDefaultLags(n), ACF_MAX_LAGS);
  const dfIn = readWhole(read("modelDf"), "Model degrees of freedom", 0, K);
  if (typeof dfIn === "object") return refuse(dfIn.error);
  const modelDf = dfIn ?? 0;

  const r = acfBiased(s.values, K);
  if (!r) return refuse(`${q(s.name)} is constant, so it has no autocorrelations.`);
  const band = acfBands(r, n);
  const pr = pacfYwAdjusted(s.values, K);
  if (!pr.ok) return refuse(pr.reason);
  const lb = ljungBox(s.values, K, modelDf);
  if (!lb.ok) return refuse(lb.reason);
  const pBand = Z975 / Math.sqrt(n);
  const checks: [string, number][] = [];
  for (let k = 1; k <= K; k++) checks.push([`ACF at lag ${k}`, r[k]], [`PACF at lag ${k}`, pr.pacf[k]], [`Q at lag ${k}`, lb.rows[k - 1].q]);
  const bad = firstNonFinite(checks);
  if (bad) return refuse(`${bad} is not a finite number for these data, so the correlogram is not reported.`);

  const rows: string[][] = [["Lag", "ACF", "95% band (±)", "PACF", "Ljung–Box Q", "df", "p"]];
  for (let k = 1; k <= K; k++) {
    const row = lb.rows[k - 1];
    rows.push([String(k), fmtFixed(r[k], 3), fmtFixed(band[k], 3), fmtFixed(pr.pacf[k], 3), fmtFixed(row.q, 3), intText(row.df), row.p === null ? "n/a" : fmtP(row.p)]);
  }
  const outside = (vals: ArrayLike<number>, b: (k: number) => number): number[] => {
    const out: number[] = [];
    for (let k = 1; k <= K; k++) if (Math.abs(vals[k]) > b(k)) out.push(k);
    return out;
  };
  const listLags = (ks: number[]): string => (ks.length === 0 ? "none" : ks.length > 12 ? `${ks.slice(0, 12).join(", ")} and ${ks.length - 12} more` : ks.join(", "));
  const acfOut = outside(r, (k) => band[k]);
  const pacfOut = outside(pr.pacf, () => pBand);
  const last = lb.rows[K - 1];

  const lines: string[] = [];
  lines.push(`Correlogram of ${s.name}: lags 1 to ${K}`);
  lines.push(spanLine(s));
  lines.push(
    last.p === null
      ? `Ljung–Box Q(${K}) = ${fmtFixed(last.q, 3)}; no p-value, since the lag does not exceed the model degrees of freedom (${modelDf}).`
      : `Ljung–Box Q(${K}) = ${fmtFixed(last.q, 3)}, χ² with ${last.df} df, p ${last.p < 0.001 ? P_BELOW : `= ${fmtP(last.p)}`}.`,
  );
  lines.push(`Outside the 95% band: ACF at lag ${listLags(acfOut)}; PACF at lag ${listLags(pacfOut)}.`);
  lines.push("");
  lines.push(
    "Conventions: the ACF uses autocovariances with divisor n about the sample mean (statsmodels acf, adjusted=False); " +
      "its 95% band at lag k is ±1.96·√((1 + 2·(r₁² + … + rₖ₋₁²))/n), Bartlett's formula, centred on zero.",
  );
  lines.push(
    `The PACF is Yule–Walker on the adjusted autocovariances (divisor n − k), statsmodels' default method "ywadjusted" in 0.15; its 95% band is ±1.96/√n = ±${fmtFixed(pBand, 3)}.`,
  );
  lines.push(
    lagsIn === undefined
      ? `Lags: statsmodels' PACF default, min(⌊10·log₁₀ n⌋, n/2 − 1) = ${K} (the ACF's own default, min(⌊10·log₁₀ n⌋, n − 1), differs only for very short series).`
      : `Lags: ${K}, as entered.`,
  );
  lines.push(
    "Ljung–Box (statsmodels acorr_ljungbox): Q = n(n + 2)·Σ rₖ²/(n − k) over lags 1 to L, compared with χ² on " +
      (modelDf > 0
        ? `L − ${modelDf} degrees of freedom (model degrees of freedom ${modelDf}, as for ARIMA residuals with p + q = ${modelDf}; "n/a" where L ≤ ${modelDf}).`
        : "L degrees of freedom (model degrees of freedom 0, a raw series)."),
  );
  lines.push(...s.notes);

  // Figure: stems drawn as one polyline along the zero axis, dots at their tips, the band as two lines.
  const panel = (vals: ArrayLike<number>, b: (k: number) => number, title: string, color: string): string => {
    const stem: { x: number; y: number }[] = [{ x: 0.5, y: 0 }];
    const tips: { x: number; y: number }[] = [];
    const up: { x: number; y: number }[] = [];
    const lo: { x: number; y: number }[] = [];
    for (let k = 1; k <= K; k++) {
      stem.push({ x: k, y: 0 }, { x: k, y: vals[k] }, { x: k, y: 0 });
      tips.push({ x: k, y: vals[k] });
      up.push({ x: k, y: b(k) });
      lo.push({ x: k, y: -b(k) });
    }
    stem.push({ x: K + 0.5, y: 0 });
    const series: Series[] = [
      { type: "line", points: up, color: "#94a3b8", label: "95% band" },
      { type: "line", points: lo, color: "#94a3b8" },
      { type: "line", points: stem, color },
      { type: "scatter", points: tips, color },
    ];
    return buildPlotSvg(series, { width: 380, height: 210, title, xlabel: "Lag", ylabel: title.split(" ")[0] });
  };
  const svg = combineSvgs([panel(r, (k) => band[k], `ACF of ${s.name}`, "#0369a1"), panel(pr.pacf, () => pBand, `PACF of ${s.name}`, "#b45309")]).svg;

  const tables: StatTable[] = [
    {
      label: `Correlogram: ${s.name}`,
      rows,
      align: ["right", "right", "right", "right", "right", "right", "right"],
      note: `ACF band by Bartlett's formula; PACF band ±${fmtFixed(pBand, 3)} at every lag. Q and p from Ljung–Box.`,
    },
  ];
  // The reading: does the series remember its past (Ljung–Box over all the lags), and its strongest autocorrelation.
  let kTop = 1;
  for (let k = 2; k <= K; k++) if (Math.abs(r[k]) > Math.abs(r[kTop])) kTop = k;
  const top = `the strongest correlation is ${fmtFixed(r[kTop], 3)} at lag ${kTop}`;
  const lbP = last.p === null ? "" : last.p < 0.001 ? `p ${P_BELOW}` : `p = ${fmtP(last.p)}`;
  const reading =
    last.p === null
      ? `With lags up to ${K}, no Ljung–Box p-value can be formed here; ${top}, ${acfOut.includes(kTop) ? "outside" : "inside"} the 95% band.`
      : last.p < 0.05
        ? `Values of ${s.name} are clearly related to their own past: the Ljung–Box test rejects “no autocorrelation up to lag ${K}” (${lbP}), and ${top}.`
        : `The data show no clear autocorrelation in ${s.name} up to lag ${K} (Ljung–Box ${lbP}); ${top}, which could be chance.`;
  return { text: lines.join("\n"), reading: fitReading(reading, last.p === null ? `No Ljung–Box p-value can be formed here; ${top}.` : `Ljung–Box test up to lag ${K}: ${lbP}; ${top}.`), svg, tables };
}

// --- ts-unitroot ------------------------------------------------------------------------------------------------------

const REG_WORD: Record<AdfRegression, string> = { n: "no constant", c: "constant", ct: "constant + trend" };

function kpssPText(r: { p: number; pBound?: "above" | "below" }): string {
  if (r.pBound === "above") return `>${NBSP}0.10`;
  if (r.pBound === "below") return `<${NBSP}0.01`;
  return fmtP(r.p);
}

/** ADF and KPSS side by side. */
export function tsUnitRootCalc(read: Read): StatOutput {
  const s = readSeries(read, 12);
  if ("error" in s) return refuse(s.error);
  const n = s.values.length;
  const regRaw = (read("regression") || "c").trim();
  if (!["c", "ct", "n"].includes(regRaw)) return refuse(`Unknown deterministic terms ${q(regRaw)}; choose constant, constant + trend, or none.`);
  const reg = regRaw as AdfRegression;
  const kreg: KpssRegression = reg === "ct" ? "ct" : "c";
  const adfMode = (read("adfMode") || "aic").trim();
  if (adfMode !== "aic" && adfMode !== "fixed") return refuse(`Unknown ADF lag choice ${q(adfMode)}.`);
  const cap = adfLagCap(n, reg);
  if (cap < 0) return refuse(`The series is too short (${n} values) for the ADF regression with ${REG_WORD[reg]}.`);
  const adfLag = readWhole(read("adfLag"), "ADF lag", 0, cap);
  if (typeof adfLag === "object") return refuse(`${adfLag.error} statsmodels allows at most n/2 − 1 − (number of trend terms) = ${cap} here.`);
  const kpssMode = (read("kpssMode") || "auto").trim();
  if (kpssMode !== "auto" && kpssMode !== "fixed") return refuse(`Unknown KPSS lag choice ${q(kpssMode)}.`);
  let kLags: number | undefined;
  if (kpssMode === "fixed") {
    const v = readWhole(read("kpssLags"), "KPSS lags", 0, n - 1);
    if (typeof v === "object") return refuse(v.error);
    if (v === undefined) return refuse("KPSS lags: enter the fixed number of lags, or choose Automatic.");
    kLags = v;
  }

  const adf = adfTest(s.values, { regression: reg, maxLag: adfLag, autolag: adfMode === "aic" });
  if (!adf.ok) return refuse(adf.reason);
  const kp = kpssTest(s.values, { regression: kreg, lags: kLags });
  if (!kp.ok) return refuse(kp.reason);
  const bad = firstNonFinite([
    ["The ADF statistic", adf.stat],
    ["The ADF p-value", adf.p],
    ["An ADF critical value", adf.crit[0] + adf.crit[1] + adf.crit[2]],
    ["The KPSS statistic", kp.stat],
  ]);
  if (bad) return refuse(`${bad} is not a finite number for this series.`);

  const adfRejects = adf.stat < adf.crit[1];
  const kpssRejects = kp.stat > kp.crit[1];
  const lagHow = adf.autolag
    ? `lag ${adf.usedLag} chosen by AIC from 0 to ${adf.maxLag}${adfLag === undefined ? " (Schwert's maximum)" : ""}`
    : `lag ${adf.usedLag}, fixed`;
  const adfP = adf.p < 0.001 ? `p ${P_BELOW}` : `p = ${fmtP(adf.p)}`;
  const kpP = kp.pBound === "above" ? `p >${NBSP}0.10` : kp.pBound === "below" ? `p <${NBSP}0.01` : kp.p < 0.001 ? `p ${P_BELOW}` : `p = ${fmtP(kp.p)}`;

  const readings: { adf: boolean; kpss: boolean; text: string }[] = [
    { adf: true, kpss: false, text: "Stationary: both tests agree there is no unit root." },
    { adf: false, kpss: true, text: "Unit root: both tests agree; difference the series (and test the differences)." },
    {
      adf: true,
      kpss: true,
      text: "Conflict: each test rejects its own null; often a structural break, a misspecified trend, or long memory (fractional integration).",
    },
    { adf: false, kpss: false, text: "Inconclusive: neither test rejects; the sample may be too short to tell." },
  ];
  const mine = readings.find((x) => x.adf === adfRejects && x.kpss === kpssRejects) as (typeof readings)[number];

  const lines: string[] = [];
  lines.push(`Unit-root tests on ${s.name}: ADF and KPSS`);
  lines.push(spanLine(s));
  lines.push(`ADF (${REG_WORD[reg]}): τ = ${fmtFixed(adf.stat, 3)}, ${adfP} (MacKinnon), ${lagHow}, ${intText(adf.nobs)} observations in the regression.`);
  lines.push(`KPSS (${REG_WORD[kreg]}): η = ${fmtFixed(kp.stat, 3)}, ${kpP}, ${kp.lags} lag${kp.lags === 1 ? "" : "s"} (${kp.auto ? "automatic bandwidth" : "fixed"}).`);
  lines.push(`At 5%: ADF ${adfRejects ? "rejects" : "does not reject"} a unit root; KPSS ${kpssRejects ? "rejects" : "does not reject"} stationarity. ${mine.text}`);
  lines.push("");
  lines.push(
    'Conventions (statsmodels 0.15): ADF is adfuller(x, maxlag, regression, autolag="AIC"): ' +
      "the regression of Δxₜ on the deterministic terms, xₜ₋₁ and lagged differences; with AIC, every lag from 0 to the maximum is fitted on the same sample (the maximum lag's), then the chosen lag is refitted on its own sample. τ is the t-ratio of xₜ₋₁.",
  );
  lines.push(
    "The ADF p-value is MacKinnon's (1994) response-surface approximation with the 2010 tables; the critical values are MacKinnon (2010) at the regression's sample size (statsmodels mackinnonp and mackinnoncrit). The 5% decisions use the critical values.",
  );
  lines.push(
    `KPSS is kpss(x, regression="${kreg}", nlags=${kp.auto ? '"auto"' : kp.lags}): η = Σ Sₜ²/(n²·s²), Sₜ the partial sums of the ${kreg === "c" ? "demeaned series" : "residuals from a linear trend"}, s² the Bartlett-weighted long-run variance` +
      (kp.auto ? "; lags by Hobijn, Franses & Ooms (1998)." : ".") +
      ` Its p-value is interpolated in the KPSS (1992) table (10%, 5%, 2.5%, 1%); outside the table it is reported as p >${NBSP}0.10 or p <${NBSP}0.01.`,
  );
  if (reg === "n") lines.push("KPSS has no form without a constant, so it keeps the constant here.");
  lines.push("ADF null: a unit root. KPSS null: stationary (around a constant, or a trend).");
  lines.push(...s.notes);

  const crit = (v: number): string => fmtFixed(v, 3);
  const testRows: string[][] = [
    ["Test", "Null hypothesis", "Statistic", "p", "Lags", "Obs.", "1%", "5%", "10%"],
    [`ADF (${REG_WORD[reg]})`, "Unit root", fmtFixed(adf.stat, 3), fmtP(adf.p), String(adf.usedLag), intText(adf.nobs), crit(adf.crit[0]), crit(adf.crit[1]), crit(adf.crit[2])],
    [`KPSS (${REG_WORD[kreg]})`, "Stationary", fmtFixed(kp.stat, 3), kpssPText(kp), String(kp.lags), intText(n), crit(kp.crit[3]), crit(kp.crit[1]), crit(kp.crit[0])],
  ];
  const readRows: string[][] = [["ADF (null: unit root)", "KPSS (null: stationary)", "What the pair says", "These data"]];
  for (const x of readings) {
    readRows.push([x.adf ? "Rejects" : "Does not reject", x.kpss ? "Rejects" : "Does not reject", x.text, x === mine ? "this result" : ""]);
  }
  const tables: StatTable[] = [
    {
      label: `Unit-root tests: ${s.name}`,
      rows: testRows,
      align: ["left", "left", "right", "right", "right", "right", "right", "right", "right"],
      note: `ADF rejects when τ is below the critical value; KPSS rejects when η is above it (KPSS 2.5%: ${crit(kp.crit[2])}).`,
    },
    { label: "Reading the pair (5% level)", rows: readRows, align: ["left", "left", "left", "left"] },
  ];

  const ax = timeAxis(s);
  const step = n > TS_FIGURE_MAX_POINTS ? Math.ceil(n / TS_FIGURE_MAX_POINTS) : 1;
  const svg = buildPlotSvg([{ type: "line", points: decimatedLine(n, ax.x, (i) => s.values[i], step), color: "#0369a1" }], {
    width: 380,
    height: 230,
    title: s.name,
    xlabel: ax.label,
    ylabel: s.name,
  });
  if (step > 1) lines.push(`The figure shows every ${step}th row.`);
  // The reading: the pair's 5% verdict (the same decisions as the text: τ and η against the 5% critical values).
  const pair = `ADF ${adfP}, KPSS ${kpP}`;
  const verdict = (nm: string, Nm: string): string =>
    !adfRejects && kpssRejects
      ? `${Nm} appears to have a unit root (it wanders without returning to a fixed level): ADF does not reject a unit root and KPSS rejects stationarity (${pair}), so analyse its changes rather than its levels.`
      : adfRejects && !kpssRejects
        ? `${Nm} appears stationary (it keeps returning to a stable ${kreg === "ct" ? "trend" : "level"}): ADF rejects a unit root and KPSS does not reject stationarity (${pair}).`
        : adfRejects && kpssRejects
          ? `The two tests conflict for ${nm}: each rejects its own null (${pair}), often a sign of a structural break or a misspecified trend.`
          : `Neither test rejects at 5% (${pair}), so these data cannot tell whether ${nm} has a unit root; a longer series may settle it.`;
  const reading = fitReading(verdict(s.name, s.name), verdict("the series", "The series"));
  return { text: lines.join("\n"), reading, svg, tables };
}

// --- ts-hp ------------------------------------------------------------------------------------------------------------

const LAMBDA_TABLE: Record<"standard" | "ru", Record<string, { v: number; src: string }>> = {
  standard: {
    quarter: { v: 1600, src: "Hodrick & Prescott 1997, quarterly" },
    year: { v: 100, src: "the common annual value" },
    month: { v: 14400, src: "the common monthly value" },
  },
  ru: {
    quarter: { v: 1600, src: "Hodrick & Prescott 1997, quarterly" },
    year: { v: 6.25, src: "Ravn & Uhlig 2002, annual: 1,600/4⁴" },
    month: { v: 129600, src: "Ravn & Uhlig 2002, monthly: 1,600·3⁴" },
  },
};

function lambdaText(v: number): string {
  return Number.isInteger(v) ? intText(v) : fmtFixed(v, Math.min(6, Math.max(2, -Math.floor(Math.log10(v)) + 3))).replace(/0+$/, "").replace(/\.$/, "");
}

/** Hodrick–Prescott trend and cycle. */
export function tsHpCalc(read: Read): StatOutput {
  const s = readSeries(read, 5);
  if ("error" in s) return refuse(s.error);
  const n = s.values.length;
  const rule = (read("lambdaRule") || "standard").trim();
  let lambda: number;
  let src: string;
  if (rule === "custom") {
    const v = readPositive(read("lambda"), "λ", HP_LAMBDA_MAX);
    if (typeof v === "object") return refuse(v.error);
    lambda = v;
    src = "as entered";
  } else if (rule === "standard" || rule === "ru") {
    const f = s.dates?.frequency;
    const hit = f ? LAMBDA_TABLE[rule][f] : undefined;
    if (!hit) {
      return refuse(
        f === "day"
          ? "λ by frequency covers annual, quarterly and monthly data; these rows are days. Choose Custom λ."
          : "λ by frequency needs dates or periods in the first column (years, quarters or months). Add them, or choose Custom λ.",
      );
    }
    lambda = hit.v;
    src = hit.src;
  } else {
    return refuse(`Unknown λ choice ${q(rule)}.`);
  }
  const hp = hpFilter(s.values, lambda);
  if (!hp.ok) return refuse(hp.reason);

  let ss = 0;
  let cmin = 0;
  let cmax = 0;
  for (let i = 0; i < n; i++) {
    ss += hp.cycle[i] * hp.cycle[i];
    if (hp.cycle[i] < hp.cycle[cmin]) cmin = i;
    if (hp.cycle[i] > hp.cycle[cmax]) cmax = i;
  }
  const sd = Math.sqrt(ss / n);
  const when = (i: number): string => (s.dates ? s.dates.tokens[i].label : `row ${i + 1}`);
  const bad = firstNonFinite([["The cycle's spread", sd]]);
  if (bad) return refuse(`${bad} is not a finite number for this series.`);

  const lines: string[] = [];
  lines.push(`Hodrick–Prescott filter of ${s.name}: λ = ${lambdaText(lambda)} (${src})`);
  lines.push(spanLine(s));
  lines.push(
    `Cycle (series − trend): root mean square ${fmtFixed(sd, 3)}; lowest ${fmtFixed(hp.cycle[cmin], 3)} (${when(cmin)}), highest ${fmtFixed(hp.cycle[cmax], 3)} (${when(cmax)}).`,
  );
  lines.push("");
  lines.push(
    "Conventions: the trend τ minimises Σ(yₜ − τₜ)² + λ·Σ(Δ²τₜ)², i.e. solves (I + λK′K)τ = y with K the second-difference matrix (statsmodels hpfilter, two-sided), " +
      "solved by a banded Cholesky factorisation in O(n). The cycle is y − τ.",
  );
  lines.push(
    rule === "custom"
      ? "λ as entered. Common choices: quarterly 1,600 (Hodrick & Prescott 1997); annual 100 or 6.25 and monthly 14,400 or 129,600 (Ravn & Uhlig 2002)."
      : rule === "standard"
        ? "λ from the data's frequency, common values: quarterly 1,600 (Hodrick & Prescott 1997), annual 100, monthly 14,400. Ravn & Uhlig (2002) recommend 6.25 annual and 129,600 monthly (the other λ choice)."
        : "λ from the data's frequency by Ravn & Uhlig (2002), who scale 1,600 by the fourth power of the frequency ratio: annual 6.25, monthly 129,600 (quarterly 1,600).",
  );
  lines.push("The filter is two-sided: the last few trend values move as new data arrive (the end-point problem).");
  lines.push(...s.notes);

  const tables: StatTable[] = [];
  if (n <= HP_TABLE_MAX_ROWS) {
    const rows: string[][] = [[s.dates ? s.dates.name : "Row", s.name, "Trend", "Cycle"]];
    for (let i = 0; i < n; i++) rows.push([s.dates ? s.dates.tokens[i].label : String(i + 1), fmtFixed(s.values[i], 3), fmtFixed(hp.trend[i], 3), fmtFixed(hp.cycle[i], 3)]);
    tables.push({ label: `HP trend and cycle: ${s.name}, λ = ${lambdaText(lambda)}`, rows, align: ["left", "right", "right", "right"] });
  } else {
    lines.push(`The table is left out above ${intText(HP_TABLE_MAX_ROWS)} rows; the figure shows the whole series.`);
  }

  const ax = timeAxis(s);
  const step = n > TS_FIGURE_MAX_POINTS ? Math.ceil(n / TS_FIGURE_MAX_POINTS) : 1;
  const top = buildPlotSvg(
    [
      { type: "line", points: decimatedLine(n, ax.x, (i) => s.values[i], step), color: "#94a3b8", label: s.name },
      { type: "line", points: decimatedLine(n, ax.x, (i) => hp.trend[i], step), color: "#0369a1", label: "HP trend" },
    ],
    { width: 380, height: 220, title: `${s.name} and HP trend`, xlabel: ax.label, ylabel: s.name },
  );
  const x0 = ax.x(0);
  const x1 = ax.x(n - 1);
  const bottom = buildPlotSvg(
    [
      { type: "line", points: [{ x: x0, y: 0 }, { x: x1, y: 0 }], color: "#94a3b8" },
      { type: "line", points: decimatedLine(n, ax.x, (i) => hp.cycle[i], step), color: "#b45309" },
    ],
    { width: 380, height: 190, title: "Cycle (series − trend)", xlabel: ax.label, ylabel: "Cycle" },
  );
  if (step > 1) lines.push(`The figure shows every ${step}th row.`);
  // The reading: how far the series swings around its smooth trend, and when it was furthest below and above.
  const swing = (nm: string): string =>
    `With λ = ${lambdaText(lambda)}, ${nm} swings around its smooth trend by ${fmtFixed(sd, 3)} on average (root mean square), from ${fmtFixed(hp.cycle[cmin], 3)} in ${when(cmin)} to ${fmtFixed(hp.cycle[cmax], 3)} in ${when(cmax)}.`;
  const endNote = " The last few trend values will shift as new data arrive.";
  const reading = fitReading(swing(s.name) + endNote, swing(s.name), swing("the series"));
  return { text: lines.join("\n"), reading, svg: combineSvgs([top, bottom]).svg, tables };
}

/** The three calculators as the pane declares them (id, title, fields, compute). */
export const TS_CALCULATORS: { id: string; name: string; fields: TsField[]; compute: (r: Read) => StatOutput }[] = [
  { id: "ts-acf", name: "Correlogram (ACF, PACF) and Ljung–Box", fields: TS_ACF_FIELDS, compute: tsAcfCalc },
  { id: "ts-unitroot", name: "Unit-root tests: ADF and KPSS", fields: TS_UNITROOT_FIELDS, compute: tsUnitRootCalc },
  { id: "ts-hp", name: "Hodrick–Prescott filter (trend and cycle)", fields: TS_HP_FIELDS, compute: tsHpCalc },
];
