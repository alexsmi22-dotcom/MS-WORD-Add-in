/**
 * Release E3b Stats calculators, as pure functions of the field reader so jest can run them:
 *  - ts-arima  ARIMA(p, d, q): exact maximum likelihood, coefficient table, Ljung–Box, h-step forecasts with 95%
 *              intervals, figure (arima.ts);
 *  - ts-ets    exponential smoothing — simple, Holt (optionally damped), Holt–Winters additive or multiplicative —
 *              with closed-form intervals where they exist (holtWinters.ts).
 * taskpane.ts only declares the fields and calls these. Every series goes through tsData.parseSeriesTable.
 *
 * Worked defaults are synthetic (scripts/econ-ts-forecast-oracle.py, seeds 2006 and 2016), pinned to statsmodels in
 * the oracle fixture, so they can ship.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { arimaForecast, fitArima, ARIMA_MAX_D, ARIMA_MAX_H, ARIMA_MAX_P, ARIMA_MAX_Q, type ArimaSpec, type ArimaTrend } from "./arima";
import { fitHoltWinters, hwForecast, hwForecastVariance, hwIntervals, HW_MAX_H, HW_MAX_M, type HwSpec } from "./holtWinters";
import { buildPlotSvg } from "./plot";
import { normalCdfPrecise } from "./probdist";
import { fmtFixed, fmtP, intText, numText } from "./regTable";
import { parseSeriesTable, pickSeries, type SeriesData } from "./tsData";
import { ljungBox as tsDiagLjungBox, ljungBoxDefaultLags } from "./tsDiag";

type Read = (key: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;

/**
 * Ljung–Box Q at `lags` for the ARIMA residuals: the last row of E3a's tsDiag.ljungBox (statsmodels acorr_ljungbox),
 * or a refusal (a constant residual series). p is null when df ≤ 0 (statsmodels returns NaN).
 */
export function ljungBox(
  x: ArrayLike<number>,
  lags: number,
  modelDf: number,
): { q: number; df: number; p: number | null } | { reason: string } {
  const r = tsDiagLjungBox(x, lags, modelDf);
  if (!r.ok) return { reason: r.reason };
  const last = r.rows[r.rows.length - 1];
  return { q: last.q, df: last.df, p: last.p };
}

// ---------------------------------------------------------------- worked defaults

/** Synthetic quarterly rate, 2006 Q1 – 2025 Q4 (ARIMA(1, 1, 1) simulation, seed 2006, rounded to 2 decimals). */
export const TS_ARIMA_DATA_DEFAULT = [
  "Quarter Rate", "2006-Q1 4.00", "2006-Q2 4.06", "2006-Q3 4.02", "2006-Q4 4.34", "2007-Q1 4.64",
  "2007-Q2 4.65", "2007-Q3 4.63", "2007-Q4 4.37", "2008-Q1 4.07", "2008-Q2 4.00", "2008-Q3 4.01",
  "2008-Q4 3.66", "2009-Q1 3.73", "2009-Q2 3.96", "2009-Q3 4.52", "2009-Q4 4.76", "2010-Q1 5.19",
  "2010-Q2 5.63", "2010-Q3 5.65", "2010-Q4 5.69", "2011-Q1 5.71", "2011-Q2 5.46", "2011-Q3 5.72",
  "2011-Q4 5.72", "2012-Q1 5.55", "2012-Q2 5.78", "2012-Q3 6.32", "2012-Q4 6.47", "2013-Q1 6.57",
  "2013-Q2 6.97", "2013-Q3 7.37", "2013-Q4 7.36", "2014-Q1 7.52", "2014-Q2 8.27", "2014-Q3 8.66",
  "2014-Q4 8.78", "2015-Q1 8.43", "2015-Q2 8.13", "2015-Q3 7.94", "2015-Q4 8.06", "2016-Q1 8.29",
  "2016-Q2 8.24", "2016-Q3 8.15", "2016-Q4 7.90", "2017-Q1 8.01", "2017-Q2 7.91", "2017-Q3 7.76",
  "2017-Q4 7.76", "2018-Q1 7.41", "2018-Q2 7.07", "2018-Q3 7.25", "2018-Q4 7.18", "2019-Q1 7.37",
  "2019-Q2 7.63", "2019-Q3 8.04", "2019-Q4 8.15", "2020-Q1 8.21", "2020-Q2 7.76", "2020-Q3 7.29",
  "2020-Q4 7.07", "2021-Q1 6.80", "2021-Q2 6.53", "2021-Q3 6.66", "2021-Q4 6.14", "2022-Q1 5.56",
  "2022-Q2 5.18", "2022-Q3 4.98", "2022-Q4 4.72", "2023-Q1 4.36", "2023-Q2 4.19", "2023-Q3 4.11",
  "2023-Q4 4.09", "2024-Q1 4.05", "2024-Q2 4.60", "2024-Q3 5.14", "2024-Q4 4.93", "2025-Q1 4.47",
  "2025-Q2 4.16", "2025-Q3 4.13", "2025-Q4 3.68",
].join("\n");

/** Synthetic monthly sales, January 2016 – December 2025 (additive Holt–Winters simulation, seed 2016, 1 decimal). */
export const TS_ETS_DATA_DEFAULT = [
  "Month Sales", "2016-01 459.3", "2016-02 482.9", "2016-03 506.6", "2016-04 518.9", "2016-05 515.0",
  "2016-06 532.1", "2016-07 525.0", "2016-08 519.5", "2016-09 513.0", "2016-10 503.0", "2016-11 488.9",
  "2016-12 478.7", "2017-01 475.1", "2017-02 485.5", "2017-03 516.4", "2017-04 526.5", "2017-05 525.0",
  "2017-06 534.3", "2017-07 535.0", "2017-08 521.8", "2017-09 512.9", "2017-10 500.0", "2017-11 500.4",
  "2017-12 494.4", "2018-01 495.8", "2018-02 498.3", "2018-03 526.0", "2018-04 540.8", "2018-05 533.0",
  "2018-06 541.1", "2018-07 550.1", "2018-08 539.7", "2018-09 512.7", "2018-10 511.9", "2018-11 502.2",
  "2018-12 491.2", "2019-01 498.4", "2019-02 493.5", "2019-03 512.3", "2019-04 514.4", "2019-05 535.1",
  "2019-06 545.8", "2019-07 540.9", "2019-08 542.4", "2019-09 530.7", "2019-10 518.5", "2019-11 523.5",
  "2019-12 514.1", "2020-01 505.0", "2020-02 508.6", "2020-03 539.7", "2020-04 554.9", "2020-05 548.9",
  "2020-06 562.1", "2020-07 573.5", "2020-08 553.1", "2020-09 535.5", "2020-10 532.7", "2020-11 533.5",
  "2020-12 520.2", "2021-01 514.9", "2021-02 529.8", "2021-03 540.5", "2021-04 557.7", "2021-05 557.1",
  "2021-06 580.7", "2021-07 579.1", "2021-08 557.5", "2021-09 564.9", "2021-10 545.9", "2021-11 548.1",
  "2021-12 526.0", "2022-01 541.1", "2022-02 537.7", "2022-03 566.5", "2022-04 575.5", "2022-05 580.7",
  "2022-06 594.8", "2022-07 587.3", "2022-08 579.0", "2022-09 565.3", "2022-10 551.9", "2022-11 550.2",
  "2022-12 547.3", "2023-01 539.5", "2023-02 543.2", "2023-03 575.6", "2023-04 589.4", "2023-05 589.2",
  "2023-06 602.2", "2023-07 602.9", "2023-08 581.5", "2023-09 584.4", "2023-10 583.7", "2023-11 574.7",
  "2023-12 573.2", "2024-01 558.4", "2024-02 569.0", "2024-03 584.4", "2024-04 602.0", "2024-05 589.9",
  "2024-06 615.3", "2024-07 614.2", "2024-08 600.2", "2024-09 601.4", "2024-10 584.8", "2024-11 578.9",
  "2024-12 565.9", "2025-01 572.5", "2025-02 575.0", "2025-03 604.3", "2025-04 606.9", "2025-05 628.9",
  "2025-06 638.7", "2025-07 628.6", "2025-08 639.1", "2025-09 618.6", "2025-10 609.7", "2025-11 614.5",
  "2025-12 586.5",
].join("\n");

/** ts-arima fields: data (block), column (text), p/d/q/trend (select), h (text). */
export const TS_ARIMA_DEFAULTS: Record<string, string> = {
  data: TS_ARIMA_DATA_DEFAULT,
  column: "",
  p: "1",
  d: "1",
  q: "1",
  trend: "auto",
  h: "8",
};

/** ts-ets fields: data (block), column (text), trend/damped/seasonal (select), m and h (text). */
export const TS_ETS_DEFAULTS: Record<string, string> = {
  data: TS_ETS_DATA_DEFAULT,
  column: "",
  trend: "add",
  damped: "no",
  seasonal: "add",
  m: "",
  h: "12",
};

export const TS_ARIMA_TREND_OPTIONS = [
  { value: "auto", label: "Default: a mean when d = 0, none when d ≥ 1" },
  { value: "constant", label: "Mean (d = 0) or drift (d = 1)" },
  { value: "none", label: "None" },
];

/** At most this many observations are drawn before the forecast. */
export const TS_FIGURE_HISTORY = 240;

// ---------------------------------------------------------------- shared helpers

/** A whole number field in [lo, hi]; blank means `def`. */
function readWhole(read: Read, key: string, label: string, def: number, lo: number, hi: number): number | { error: string } {
  const raw = (read(key) ?? "").trim();
  if (raw === "") return def;
  const v = Number(raw.replace(/−/g, "-"));
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < lo || v > hi) {
    return { error: `${label}: ${q(raw)} is not a whole number from ${lo} to ${hi}.` };
  }
  return v;
}

function readSeries(read: Read, minRows: number): { data: SeriesData; name: string; values: Float64Array } | { error: string } {
  const parsed = parseSeriesTable(read("data") ?? "", { minRows });
  if (!parsed.ok) return { error: parsed.reason };
  const data = parsed.data;
  const dates = data.dates;
  if (dates && dates.frequency === "irregular") {
    return {
      error: dates.gap
        ? `The periods are not evenly spaced: ${dates.gap}. A time-series model needs every period; fill the gap.`
        : "The dates mix kinds of period (years, quarters, months or days), so the spacing is not even.",
    };
  }
  const pick = pickSeries(data, read("column") ?? "");
  if (!pick.ok) return { error: pick.reason };
  for (let i = 0; i < pick.values.length; i++) {
    if (!Number.isFinite(pick.values[i])) return { error: `Row ${i + 1} of ${q(pick.name)} is not a finite number.` };
  }
  return { data, name: pick.name, values: pick.values };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Labels and plot positions for the observations and the next `h` periods. */
function timeAxis(data: SeriesData, n: number, h: number): { x: number[]; fx: number[]; labels: string[] | null; xlabel: string } {
  const d = data.dates;
  if (d && (d.frequency === "year" || d.frequency === "quarter" || d.frequency === "month")) {
    const last = d.tokens[d.tokens.length - 1].label;
    const per = d.frequency === "year" ? 1 : d.frequency === "quarter" ? 4 : 12;
    let y0 = 0;
    let k0 = 0; // 0-based sub-period of the last row
    if (d.frequency === "year") y0 = Number(last);
    else if (d.frequency === "quarter") {
      const m = /^(\d{4}) Q([1-4])$/.exec(last);
      y0 = m ? Number(m[1]) : 0;
      k0 = m ? Number(m[2]) - 1 : 0;
    } else {
      const m = /^(\S+) (\d{4})$/.exec(last);
      y0 = m ? Number(m[2]) : 0;
      k0 = m ? Math.max(0, MONTHS.indexOf(m[1])) : 0;
    }
    const pos = (offset: number): number => y0 + (k0 + offset) / per;
    const x: number[] = [];
    for (let i = 0; i < n; i++) x.push(pos(i - (n - 1)));
    const fx: number[] = [];
    const labels: string[] = [];
    for (let j = 1; j <= h; j++) {
      fx.push(pos(j));
      const idx = k0 + j;
      const yy = y0 + Math.floor(idx / per);
      const sub = idx % per;
      labels.push(d.frequency === "year" ? String(yy) : d.frequency === "quarter" ? `${yy} Q${sub + 1}` : `${MONTHS[sub]} ${yy}`);
    }
    return { x, fx, labels, xlabel: "Year" };
  }
  const x: number[] = [];
  for (let i = 1; i <= n; i++) x.push(i);
  const fx: number[] = [];
  for (let j = 1; j <= h; j++) fx.push(n + j);
  return { x, fx, labels: null, xlabel: d ? "Observation (trading day)" : "Observation" };
}

/** Decimals giving about `sig` significant digits for the largest magnitude in a column. */
function colDecimals(values: number[], sig = 5): number {
  let mx = 0;
  for (const v of values) if (Number.isFinite(v)) mx = Math.max(mx, Math.abs(v));
  if (!(mx > 0)) return 2;
  return Math.max(0, Math.min(6, sig - 1 - Math.floor(Math.log10(mx))));
}

function forecastFigure(
  name: string,
  ax: { x: number[]; fx: number[]; xlabel: string },
  y: ArrayLike<number>,
  mean: number[],
  lower: number[] | null,
  upper: number[] | null,
  title: string,
  fitted?: ArrayLike<number>,
): { svg: string; note: string | null } {
  const n = y.length;
  const start = Math.max(0, n - TS_FIGURE_HISTORY);
  const hist: { x: number; y: number }[] = [];
  for (let i = start; i < n; i++) hist.push({ x: ax.x[i], y: y[i] });
  const fc = [{ x: ax.x[n - 1], y: y[n - 1] }, ...mean.map((v, j) => ({ x: ax.fx[j], y: v }))];
  const series: Parameters<typeof buildPlotSvg>[0] = [{ type: "line", points: hist, color: "#334155", label: name }];
  if (fitted) {
    const fp: { x: number; y: number }[] = [];
    for (let i = start; i < n; i++) fp.push({ x: ax.x[i], y: fitted[i] });
    series.push({ type: "line", points: fp, color: "#94a3b8", label: "fitted" });
  }
  series.push({ type: "line", points: fc, color: "#0369a1", label: "forecast" });
  if (lower && upper) {
    series.push({ type: "line", points: lower.map((v, j) => ({ x: ax.fx[j], y: v })), color: "#7dd3fc", label: "95% interval" });
    series.push({ type: "line", points: upper.map((v, j) => ({ x: ax.fx[j], y: v })), color: "#7dd3fc" });
  }
  const svg = buildPlotSvg(series, { width: 420, height: 260, title, xlabel: ax.xlabel, ylabel: name });
  const note = start > 0 ? `The figure shows the last ${intText(n - start)} of ${intText(n)} observations.` : null;
  return { svg, note };
}

// ---------------------------------------------------------------- ts-arima

function trendOf(choice: string, d: number): ArimaTrend | { error: string } {
  if (choice === "auto" || choice === "") return d === 0 ? "mean" : "none";
  if (choice === "none") return "none";
  if (choice === "constant") {
    if (d === 0) return "mean";
    if (d === 1) return "drift";
    return { error: "A drift term needs d = 1 (with d = 2 a constant would be a quadratic trend); choose “None” or d = 1." };
  }
  return { error: `Unknown trend option ${q(choice)}.` };
}

const sub = (k: number): string => String(k).replace(/\d/g, (c) => "₀₁₂₃₄₅₆₇₈₉"[Number(c)]);

/** ARIMA(p, d, q): fit, coefficient table, Ljung–Box, forecasts. */
export function tsArimaCalc(read: Read): StatOutput {
  const p = readWhole(read, "p", "AR order p", 1, 0, ARIMA_MAX_P);
  if (typeof p !== "number") return refuse(p.error);
  const d = readWhole(read, "d", "Differencing d", 1, 0, ARIMA_MAX_D);
  if (typeof d !== "number") return refuse(d.error);
  const qq = readWhole(read, "q", "MA order q", 1, 0, ARIMA_MAX_Q);
  if (typeof qq !== "number") return refuse(qq.error);
  const h = readWhole(read, "h", "Forecast horizon", 8, 1, ARIMA_MAX_H);
  if (typeof h !== "number") return refuse(h.error);
  const trend = trendOf((read("trend") ?? "auto").trim(), d);
  if (typeof trend !== "string") return refuse(trend.error);
  const spec: ArimaSpec = { p, d, q: qq, trend };
  const k = p + qq + (trend === "none" ? 0 : 1) + 1;
  const minN = Math.max(15, 3 * k);
  const s = readSeries(read, minN + d);
  if ("error" in s) return refuse(s.error);
  const { data, name, values } = s;
  const n = values.length;

  const fit = fitArima(values, spec);
  if (!fit.ok) return refuse(fit.reason);
  const prm = fit.params;
  const fc = arimaForecast(values, spec, prm, h);
  if (!fc) return refuse("The forecast could not be formed at the fitted parameters.");
  const N = fit.nobs;
  const finite = [fit.llf, fit.aic, fit.bic, prm.sigma2, prm.mu, ...prm.phi, ...prm.theta, ...fc.mean, ...fc.lower, ...fc.upper];
  if (!finite.every(Number.isFinite)) return refuse("A fitted quantity is not a finite number for this series (an extreme scale), so the result is not reported.");

  const model = `ARIMA(${p}, ${d}, ${qq})`;
  const trendWord = trend === "mean" ? " with a mean" : trend === "drift" ? " with drift" : "";
  const lines: string[] = [];
  lines.push(`${model}${trendWord} for ${name} (n = ${intText(n)}${d ? `; ${intText(N)} differenced observations` : ""})`);
  const sd = colDecimals([prm.sigma2], 5);
  lines.push(`σ² = ${fmtFixed(prm.sigma2, sd)} · log likelihood = ${fmtFixed(fit.llf, 3)}`);
  lines.push(
    `AIC = ${fmtFixed(fit.aic, 3)} · AICc = ${fit.aicc === null ? "not defined (too few observations for the parameters)" : fmtFixed(fit.aicc, 3)} · BIC = ${fmtFixed(fit.bic, 3)}`,
  );
  const lags = ljungBoxDefaultLags(N);
  let lbLine: string;
  if (lags < 1) lbLine = "Ljung–Box not computed: fewer than 5 differenced observations.";
  else {
    const lb = ljungBox(fit.stdResid, lags, p + qq);
    lbLine =
      "reason" in lb
        ? `Ljung–Box not computed: ${lb.reason}`
        : lb.p === null
        ? `Ljung–Box not computed: ${lags} lags leave no degrees of freedom after p + q = ${p + qq}.`
        : `Ljung–Box on the standardized residuals: Q(${lags}) = ${fmtFixed(lb.q, 3)}, df = ${lb.df}, p ${lb.p < 0.001 ? fmtP(lb.p) : `= ${fmtP(lb.p)}`}${lb.p < 0.05 ? " (residual autocorrelation remains at 5%)" : ""}`;
  }
  lines.push(lbLine);
  lines.push("");
  lines.push(
    "Conventions: exact Gaussian likelihood by the Kalman filter on the ARMA state space, started at the stationary covariance (the discrete Lyapunov equation). Simple differencing: the likelihood is that of the n − d differenced values, as statsmodels SARIMAX(simple_differencing=True) computes it. (statsmodels' default ARIMA puts the integrated states under an approximate-diffuse prior of variance 10⁶, which depends on the units of the series; that form is not used.)",
  );
  if (trend !== "none") {
    lines.push(
      `The ${trend === "mean" ? "mean" : "drift"} is the mean of the ${d ? "differenced " : ""}series: (w − μ) follows the ARMA, the form statsmodels' ARIMA and R's arima report (not the intercept μ(1 − Σφ)).`,
    );
  }
  lines.push(
    "Estimation: σ² concentrated out; BFGS in statsmodels' unconstrained parametrisation (Monahan 1984; Jones 1980), so every iterate is stationary and invertible; starts from Hannan–Rissanen (1982) and from zero, best maximum kept.",
  );
  lines.push(
    "Standard errors: inverse of the negative numerical Hessian of the log likelihood (central differences in the constrained parameters, σ² included; statsmodels' cov_type=\"approx\", whose default is the outer-product estimate). z and p from the normal distribution.",
  );
  lines.push(
    `Information criteria (statsmodels' definitions): AIC = −2 log L + 2k, AICc = −2 log L + 2kN/(N − k − 1), BIC = −2 log L + k ln N, with k = ${k} (σ² counted) and N = n − d = ${intText(N)}.`,
  );
  lines.push(
    `Ljung–Box: standardized one-step residuals, lags = min(10, ⌊N/5⌋), df = lags − (p + q) (statsmodels' lag rule; its df_adjust option would also count the ${trend === "none" ? "trend term, if any" : "mean or drift"}).`,
  );
  lines.push("Forecast intervals: forecast ± 1.96 SE (normal), treating the observed levels as known; they do not include parameter uncertainty.");
  if (data.dates?.frequency === "day") lines.push("Daily dates are treated as consecutive observations (trading days), whatever the calendar gaps.");
  lines.push(...fit.notes, ...data.notes);
  if (!fit.se && fit.seWhy) lines.push(`Standard errors not reported: ${fit.seWhy}.`);

  // Coefficient table.
  const terms: { label: string; est: number; se: number | null; test: boolean }[] = [];
  let si = 0;
  const se = fit.se;
  if (trend !== "none") terms.push({ label: trend === "mean" ? "Mean" : "Drift", est: prm.mu, se: se ? se[si++] : null, test: true });
  prm.phi.forEach((v, i) => terms.push({ label: `AR(${i + 1}) φ${sub(i + 1)}`, est: v, se: se ? se[si++] : null, test: true }));
  prm.theta.forEach((v, i) => terms.push({ label: `MA(${i + 1}) θ${sub(i + 1)}`, est: v, se: se ? se[si++] : null, test: true }));
  terms.push({ label: "σ²", est: prm.sigma2, se: se ? se[si] : null, test: false });
  const dec = colDecimals(terms.map((t) => t.est), 5);
  const coefRows: string[][] = [["Term", "Estimate", "SE", "z", "p"]];
  for (const t of terms) {
    const dd = t.label === "σ²" ? sd : t.label === "Mean" || t.label === "Drift" ? colDecimals([t.est, t.se ?? 0], 5) : Math.max(4, dec);
    const z = t.se ? t.est / t.se : NaN;
    const pv = Number.isFinite(z) ? 2 * normalCdfPrecise(-Math.abs(z)) : NaN;
    coefRows.push([
      t.label,
      fmtFixed(t.est, dd),
      t.se ? fmtFixed(t.se, dd) : "",
      t.test && Number.isFinite(z) ? fmtFixed(z, 3) : "",
      t.test && Number.isFinite(pv) ? fmtP(pv) : "",
    ]);
  }
  const tables: StatTable[] = [
    {
      label: `${model}${trendWord}: ${name}`,
      rows: coefRows,
      align: ["left", "right", "right", "right", "right"],
      note: "z and p are not shown for σ² (a variance is not tested against zero).",
    },
  ];

  const ax = timeAxis(data, n, h);
  const fdec = colDecimals([...fc.mean, ...fc.lower, ...fc.upper], 6);
  const sdec = colDecimals(fc.se, 5);
  const head = ax.labels ? ["h", "Period", "Forecast", "SE", "95% lower", "95% upper"] : ["h", "Forecast", "SE", "95% lower", "95% upper"];
  const fRows: string[][] = [head];
  for (let j = 0; j < fc.mean.length; j++) {
    fRows.push([
      String(j + 1),
      ...(ax.labels ? [ax.labels[j]] : []),
      fmtFixed(fc.mean[j], fdec),
      fmtFixed(fc.se[j], sdec),
      fmtFixed(fc.lower[j], fdec),
      fmtFixed(fc.upper[j], fdec),
    ]);
  }
  tables.push({
    label: `Forecasts of ${name}, ${h} period${h === 1 ? "" : "s"} ahead`,
    rows: fRows,
    align: ax.labels ? ["right", "left", "right", "right", "right", "right"] : ["right", "right", "right", "right", "right"],
    note: "95% interval: forecast ± 1.96 SE.",
  });
  const fig = forecastFigure(name, ax, values, fc.mean, fc.lower, fc.upper, `${model} forecast`);
  if (fig.note) lines.push(fig.note);
  return { text: lines.join("\n"), tables, svg: fig.svg };
}

// ---------------------------------------------------------------- ts-ets

function modelName(spec: HwSpec): string {
  if (spec.trend === "none" && spec.seasonal === "none") return "Simple exponential smoothing";
  if (spec.seasonal === "none") return spec.damped ? "Holt's method, damped additive trend" : "Holt's method, additive trend";
  const t = spec.trend === "none" ? "no trend" : spec.damped ? "damped additive trend" : "additive trend";
  return `Holt–Winters, ${t}, ${spec.seasonal === "add" ? "additive" : "multiplicative"} seasonality (m = ${spec.m})`;
}

/** Exponential smoothing: fit by least squares, parameters, forecasts (with intervals where a closed form exists). */
export function tsEtsCalc(read: Read): StatOutput {
  const trendRaw = (read("trend") ?? "add").trim() || "add";
  if (trendRaw !== "none" && trendRaw !== "add") return refuse(`Unknown trend option ${q(trendRaw)} (none or additive).`);
  const seasRaw = (read("seasonal") ?? "add").trim() || "add";
  if (seasRaw !== "none" && seasRaw !== "add" && seasRaw !== "mul") return refuse(`Unknown seasonality option ${q(seasRaw)} (none, additive or multiplicative).`);
  const dampRaw = (read("damped") ?? "no").trim() || "no";
  if (dampRaw !== "no" && dampRaw !== "yes") return refuse(`Unknown damping option ${q(dampRaw)} (yes or no).`);
  const h = readWhole(read, "h", "Forecast horizon", 8, 1, HW_MAX_H);
  if (typeof h !== "number") return refuse(h.error);
  const damped = dampRaw === "yes" && trendRaw === "add";

  const s = readSeries(read, 3);
  if ("error" in s) return refuse(s.error);
  const { data, name, values } = s;
  const n = values.length;

  let m = 0;
  const notes: string[] = [];
  if (seasRaw !== "none") {
    const mRaw = (read("m") ?? "").trim();
    if (mRaw === "") {
      const f = data.dates?.frequency;
      if (f === "quarter") m = 4;
      else if (f === "month") m = 12;
      else {
        return refuse(
          f
            ? `The dates are ${f === "year" ? "years" : "days"}, so there is no standard seasonal period: enter the period m (for example 5 for trading weeks).`
            : "The table has no quarterly or monthly dates, so enter the seasonal period m (4 for quarters, 12 for months).",
        );
      }
      notes.push(`Seasonal period m = ${m} from the ${data.dates?.frequency === "quarter" ? "quarterly" : "monthly"} dates.`);
    } else {
      const mv = readWhole(read, "m", "Seasonal period m", 0, 2, HW_MAX_M);
      if (typeof mv !== "number") return refuse(mv.error);
      m = mv;
    }
  }
  if (dampRaw === "yes" && trendRaw === "none") notes.push("Damping applies to a trend; with no trend it is ignored.");
  const spec: HwSpec = { trend: trendRaw, damped, seasonal: seasRaw, m };
  const kAll = (trendRaw === "add" ? 2 : 0) + 2 + (damped ? 1 : 0) + m + (m ? 1 : 0);
  const minN = Math.max(10, 2 * m, kAll + 4);
  if (n < minN) {
    return refuse(
      `The series has ${intText(n)} rows; this model needs at least ${minN}${m ? ` (two full seasonal cycles of ${m} and enough rows for the ${kAll} estimated parameters)` : ""}.`,
    );
  }
  if (seasRaw === "mul") {
    for (let i = 0; i < n; i++) {
      if (!(values[i] > 0)) {
        const when = data.dates ? ` (${data.dates.tokens[i].label})` : "";
        return refuse(`Row ${i + 1}${when} is ${numText(values[i])}; multiplicative seasonality needs every value above zero. Use additive seasonality.`);
      }
    }
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    mn = Math.min(mn, values[i]);
    mx = Math.max(mx, values[i]);
  }
  if (!(mx > mn)) return refuse("The series is constant, so there is nothing to smooth.");

  const fit = fitHoltWinters(values, spec);
  if (!fit.ok) return refuse(fit.reason);
  const prm = fit.params;
  const mean = hwForecast(values, spec, prm, h);
  const variance = hwForecastVariance(spec, prm, fit.sse, n, h);
  const bands = variance ? hwIntervals(mean, variance) : null;
  const finite = [fit.sse, fit.aic, fit.bic, prm.l0, prm.b0, ...prm.s0, ...mean, ...(bands ? [...bands.lower, ...bands.upper] : [])];
  if (!finite.every(Number.isFinite)) {
    return refuse("The sum of squared errors or a forecast overflows double precision for values this large (near 10³⁰⁸), so the result is not reported; rescale the series (for example, to millions).");
  }

  const lines: string[] = [];
  lines.push(`${modelName(spec)} for ${name} (n = ${intText(n)})`);
  const sigma2 = fit.sse / n;
  const vd = colDecimals([fit.sse, sigma2], 5);
  lines.push(`SSE = ${fmtFixed(fit.sse, vd)} · σ² = SSE/n = ${fmtFixed(sigma2, colDecimals([sigma2], 5))}`);
  lines.push(
    `AIC = ${fmtFixed(fit.aic, 3)} · AICc = ${fit.aicc === null ? "not defined (too few rows for the parameters)" : fmtFixed(fit.aicc, 3)} · BIC = ${fmtFixed(fit.bic, 3)}`,
  );
  if (fit.atBounds.length) lines.push(`On the boundary of the parameter space: ${fit.atBounds.join("; ")}.`);
  lines.push("");
  lines.push(
    "Conventions: statsmodels ExponentialSmoothing(initialization_method=\"estimated\"), recursions in error-correction form; α ∈ [√ε, 1 − √ε], 0 ≤ β ≤ α, 0 ≤ γ ≤ 1 − α, φ ∈ [0.8, 0.995] (ε the double-precision epsilon); the initial level, trend and seasonals are estimated with the smoothing parameters by least squares (minimum SSE).",
  );
  if (m) {
    lines.push(
      `Initial seasonals are reported normalised to ${seasRaw === "add" ? "sum to 0" : "average 1"}; the fit does not change (level and seasonals trade ${seasRaw === "add" ? "a constant" : "a factor"} exactly).`,
    );
    lines.push(
      "Forecasts by the textbook formula (Hyndman et al. 2008), as statsmodels' ETSModel computes them; statsmodels 0.15's ExponentialSmoothing.forecast takes the seasonal from one cycle too early at horizons m, 2m, …, which is not copied.",
    );
  }
  lines.push(
    bands
      ? "95% prediction intervals from the closed-form forecast variances of the additive-error state-space model (Hyndman et al. 2008, class 1; statsmodels ETSModel): σ²[1 + Σ_{j<h} c_j²], c_j = α + αβφ_j + γ·[j a multiple of m], σ² = SSE/n."
      : "No prediction intervals: multiplicative seasonality has no closed-form forecast variance, and simulated intervals would change from run to run.",
  );
  lines.push(
    `Information criteria as statsmodels' HoltWinters results define them (least squares, not a likelihood; not comparable with ARIMA's): AIC = n ln(SSE/n) + 2k, AICc = AIC + 2(k + 2)(k + 3)/(n − k − 3), BIC = n ln(SSE/n) + k ln n, k = ${fit.k}.`,
  );
  if (data.dates?.frequency === "day") lines.push("Daily dates are treated as consecutive observations (trading days).");
  lines.push(...notes, ...data.notes);

  const pRows: string[][] = [["Parameter", "Value"]];
  pRows.push(["α (level)", fmtFixed(prm.alpha, 4)]);
  if (spec.trend === "add") pRows.push(["β (trend)", fmtFixed(prm.beta, 4)]);
  if (m) pRows.push(["γ (seasonal)", fmtFixed(prm.gamma, 4)]);
  if (damped) pRows.push(["φ (damping)", fmtFixed(prm.phi, 4)]);
  const stDec = colDecimals([prm.l0, ...(spec.trend === "add" ? [prm.b0] : []), ...(seasRaw === "add" ? prm.s0 : [])], 6);
  pRows.push(["Initial level", fmtFixed(prm.l0, stDec)]);
  if (spec.trend === "add") pRows.push(["Initial trend", fmtFixed(prm.b0, stDec)]);
  const firstLabels = data.dates ? data.dates.tokens.slice(0, m).map((t) => t.label) : null;
  prm.s0.forEach((v, i) => pRows.push([`Initial seasonal ${i + 1}${firstLabels ? ` (${firstLabels[i]})` : ""}`, fmtFixed(v, seasRaw === "mul" ? 4 : stDec)]));
  const tables: StatTable[] = [
    {
      label: `${modelName(spec)}: ${name}`,
      rows: pRows,
      align: ["left", "right"],
      note: m ? `Initial seasonal i applies to row i (the first cycle of ${m}).` : undefined,
    },
  ];

  const ax = timeAxis(data, n, h);
  const fdec = colDecimals([...mean, ...(bands ? [...bands.lower, ...bands.upper] : [])], 6);
  const head = [...["h"], ...(ax.labels ? ["Period"] : []), "Forecast", ...(bands ? ["95% lower", "95% upper"] : [])];
  const fRows: string[][] = [head];
  for (let j = 0; j < mean.length; j++) {
    fRows.push([
      String(j + 1),
      ...(ax.labels ? [ax.labels[j]] : []),
      fmtFixed(mean[j], fdec),
      ...(bands ? [fmtFixed(bands.lower[j], fdec), fmtFixed(bands.upper[j], fdec)] : []),
    ]);
  }
  tables.push({
    label: `Forecasts of ${name}, ${h} period${h === 1 ? "" : "s"} ahead`,
    rows: fRows,
    align: head.map((c) => (c === "Period" ? "left" : "right")),
    note: bands ? "95% interval: forecast ± 1.96 √(forecast variance)." : "No intervals for multiplicative seasonality (no closed form).",
  });
  const fig = forecastFigure(name, ax, values, mean, bands?.lower ?? null, bands?.upper ?? null, `${modelName(spec).split(",")[0]} forecast`, fit.fitted);
  if (fig.note) lines.push(fig.note);
  return { text: lines.join("\n"), tables, svg: fig.svg };
}
