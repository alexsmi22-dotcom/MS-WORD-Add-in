/**
 * Release F2 item #10, Time series II — Stats calculators (spread into the pane's STAT_CALCS):
 *  - ts-garch           GARCH(1,1), GJR-GARCH(1,1,1), EGARCH(1,1,1) by maximum likelihood (normal or Student-t errors,
 *                       constant or zero mean): robust (Bollerslev–Wooldridge) SEs, persistence and half-life, k-step
 *                       variance forecast, conditional-volatility figure (arch 8.0 conventions);
 *  - ts-var             VAR(p): lag-order criteria (AIC, BIC, HQ, FPE), OLS estimates, Granger causality F tests;
 *  - ts-var-irf         VAR(p): orthogonalised (Cholesky) impulse responses with asymptotic 95% bands, FEVD;
 *  - ts-engle-granger   Engle–Granger residual ADF with MacKinnon cointegration p-values and critical values;
 *  - ts-johansen        Johansen trace and maximum-eigenvalue tests with Osterwald-Lenum critical values.
 * Engines in ts2.ts; every series goes through tsData.parseSeriesTable / pickSeries. The worked defaults are synthetic
 * (scripts/ts2-oracle.py, seeds 20261027, 1996, 2009), pinned to arch / statsmodels in the oracle fixture.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { readFinanceField } from "./finance";
import { composePanels } from "./panels";
import { buildPlotSvg, type Series } from "./plot";
import { fmtFixed, fmtP, fmtSci, intText } from "./regTable";
import type { StatCalcDef } from "./statCalc";
import { parseSeriesTable, pickSeries, type SeriesData } from "./tsData";
import {
  COINT_MAX_K,
  COINT_MAX_N,
  GARCH_MAX_H,
  GARCH_FLOOR_SHARE,
  GARCH_MAX_N,
  GARCH_MIN_N,
  JOHANSEN_MAX_KDIFF,
  VAR_MAX_H,
  VAR_MAX_K,
  VAR_MAX_N,
  VAR_MAX_P,
  engleGranger,
  fitGarch,
  fitVarOls,
  johansen,
  normalP,
  varGranger,
  varIrf,
  varMaxEstimable,
  varMaxRoot,
  varSelectOrder,
  type CointTrend,
  type GarchDist,
  type GarchMean,
  type GarchVol,
  type JohansenDet,
  type LagOrderRow,
  type VarFit,
} from "./ts2";

type Read = (key: string) => string;
const refuse = (text: string): StatOutput => ({ text, ok: false });
const q = (s: string): string => `“${s}”`;
const MINUS = "−";

// ---------------------------------------------------------------- worked defaults (synthetic, scripts/ts2-oracle.py)

/** 500 daily returns in percent: GJR-GARCH(1,1,1) with Student-t(7) errors, seed 20261027, 3 decimals. */
export const TS_GARCH_DATA_DEFAULT = [
  "Return",
  "2.073", "0.327", "0.932", "-0.723", "0.112", "0.528", "-1.364", "-0.267", "1.285", "1.130", "0.549", "-0.034", "0.052", "-0.646", "0.494", "-0.544", "1.439", "-0.055", "0.156", "-0.122",
  "-1.563", "0.990", "-0.388", "-0.765", "0.377", "-0.261", "0.912", "0.393", "0.423", "-0.711", "-0.270", "-0.652", "0.237", "0.040", "0.142", "0.108", "1.294", "-0.052", "-0.044", "-0.318",
  "-0.042", "-0.196", "-0.158", "-0.151", "0.426", "0.175", "0.436", "-0.344", "1.197", "0.124", "-0.623", "0.252", "0.148", "-0.070", "0.527", "-0.180", "-1.063", "-1.642", "0.489", "-0.409",
  "0.480", "0.727", "-0.217", "0.170", "0.027", "-1.040", "0.757", "0.327", "-0.172", "-0.521", "0.903", "-0.292", "-0.399", "0.210", "1.160", "0.168", "-0.056", "-0.326", "0.103", "0.000",
  "-1.089", "-0.845", "0.086", "-0.258", "0.728", "0.583", "0.287", "0.751", "-0.334", "0.844", "-0.319", "-0.065", "-0.167", "0.178", "0.878", "-0.098", "1.440", "0.322", "-0.205", "-0.162",
  "-0.282", "0.148", "0.136", "1.351", "0.168", "0.303", "-1.022", "-0.404", "-1.268", "0.188", "0.479", "-0.344", "0.766", "-0.550", "-0.662", "0.626", "-0.926", "-0.804", "-0.897", "-0.282",
  "0.594", "0.871", "0.180", "-0.473", "-0.989", "0.380", "0.047", "-0.383", "1.671", "-0.510", "-0.357", "0.407", "0.759", "0.481", "-0.270", "0.436", "-1.374", "0.001", "0.462", "-0.975",
  "1.246", "2.103", "1.352", "-0.564", "0.578", "0.039", "1.156", "1.078", "1.418", "0.803", "-0.271", "-0.130", "-0.581", "-0.050", "1.248", "1.428", "-0.240", "-0.474", "-0.467", "-0.117",
  "-0.430", "-0.951", "0.389", "0.381", "-0.201", "-0.021", "-0.650", "0.169", "0.153", "0.195", "0.006", "-0.178", "0.193", "0.453", "0.526", "0.465", "0.382", "-0.078", "0.963", "-0.157",
  "-0.304", "0.870", "-0.392", "0.242", "0.484", "-1.064", "0.061", "-0.631", "1.058", "-0.801", "0.066", "0.403", "1.562", "-0.390", "-0.057", "0.563", "-0.219", "0.419", "-2.178", "1.168",
  "-0.071", "1.240", "0.549", "-1.008", "-0.661", "0.259", "-0.154", "-0.463", "0.515", "-0.317", "0.809", "0.983", "-1.366", "1.918", "-0.345", "0.264", "-0.818", "-0.239", "-0.966", "-0.307",
  "0.326", "0.005", "1.296", "0.077", "-0.109", "0.663", "0.934", "0.362", "0.093", "0.108", "-0.299", "-0.377", "0.519", "-0.480", "-0.531", "-0.557", "0.362", "0.162", "0.017", "0.464",
  "1.327", "-1.322", "0.196", "0.739", "-0.216", "1.828", "-0.622", "-0.176", "0.147", "-0.799", "0.962", "-0.560", "-0.612", "-0.406", "1.565", "-0.544", "-0.810", "-1.600", "0.792", "0.515",
  "0.402", "1.432", "-0.065", "1.035", "1.849", "0.045", "0.001", "0.192", "-0.073", "0.190", "-0.453", "-0.076", "0.576", "0.238", "0.250", "-0.581", "0.376", "-0.661", "-0.490", "1.102",
  "-0.562", "0.593", "0.051", "-0.590", "-0.597", "0.863", "0.573", "-0.314", "-0.039", "0.499", "0.220", "0.486", "-0.178", "-0.396", "0.210", "-0.373", "-0.696", "0.269", "-0.120", "-0.001",
  "-0.050", "2.321", "0.751", "0.180", "-1.597", "-0.294", "0.480", "-0.466", "-0.136", "0.116", "0.188", "0.174", "-0.769", "-0.330", "0.438", "0.203", "0.004", "-0.897", "0.330", "-0.347",
  "-0.547", "-0.113", "-0.089", "1.626", "0.324", "0.798", "0.609", "-1.939", "0.779", "1.888", "-1.302", "-0.260", "-1.377", "-0.842", "-0.556", "-0.617", "0.562", "-0.007", "-1.067", "0.461",
  "0.221", "-0.663", "1.697", "0.091", "-0.338", "0.049", "-0.359", "1.009", "-1.514", "0.765", "0.643", "0.827", "0.299", "0.076", "0.542", "-0.811", "1.040", "-0.178", "-0.101", "0.028",
  "-0.586", "1.890", "-0.087", "-0.046", "-0.246", "0.321", "-1.182", "0.400", "-2.335", "0.668", "-1.482", "-0.972", "-1.937", "0.015", "0.244", "0.791", "-0.415", "0.485", "-0.490", "0.686",
  "0.767", "0.115", "-0.444", "0.565", "0.045", "0.072", "0.005", "0.528", "-1.102", "-0.477", "-0.105", "0.587", "-0.115", "-0.479", "0.835", "-0.064", "0.337", "0.088", "0.647", "0.035",
  "-0.524", "0.787", "-0.356", "0.309", "0.144", "-0.254", "0.005", "-0.366", "0.648", "-0.019", "-0.762", "0.184", "-0.031", "0.758", "-0.074", "1.144", "-0.500", "1.139", "-1.218", "-0.517",
  "0.380", "-1.495", "0.677", "-0.490", "-0.638", "-1.251", "1.686", "0.721", "-0.162", "-0.020", "-0.853", "1.828", "0.805", "-0.785", "2.494", "-1.508", "1.106", "0.757", "-0.346", "0.478",
  "1.136", "0.065", "-0.141", "0.704", "0.015", "0.055", "0.337", "0.497", "0.829", "-0.203", "-0.842", "-0.822", "0.469", "0.580", "0.626", "0.669", "1.088", "0.361", "-0.341", "-0.970",
  "-0.888", "-0.330", "0.268", "0.027", "1.838", "-0.510", "-0.296", "0.183", "0.812", "0.136", "0.990", "0.222", "0.302", "-0.896", "-0.165", "0.340", "-0.409", "0.543", "-0.092", "1.152",
  "0.017", "-0.188", "-0.389", "-0.157", "0.454", "-0.727", "1.067", "0.178", "-1.103", "0.818", "0.146", "0.453", "2.270", "1.047", "-0.157", "1.169", "-0.049", "-0.226", "-0.214", "-0.514",
].join("\n");

/** Three quarterly series 1996 Q1 – 2025 Q4 from a stationary VAR(2), seed 1996, 2 decimals. */
export const TS_VAR_DATA_DEFAULT = [
  "Quarter Growth Inflation Rate",
  "1996-Q1 1.16 2.65 4.27", "1996-Q2 1.59 2.29 5.08", "1996-Q3 0.93 2.56 4.87", "1996-Q4 0.36 2.61 4.62", "1997-Q1 -1.02 2.17 4.30", "1997-Q2 0.32 2.85 4.20",
  "1997-Q3 0.32 2.29 4.24", "1997-Q4 0.02 2.54 3.96", "1998-Q1 0.05 2.50 3.63", "1998-Q2 1.82 2.55 3.72", "1998-Q3 1.17 2.24 4.37", "1998-Q4 1.79 2.54 4.40",
  "1999-Q1 0.08 2.49 4.92", "1999-Q2 1.59 2.68 4.62", "1999-Q3 1.02 3.44 5.00", "1999-Q4 1.72 2.93 4.94", "2000-Q1 0.61 2.96 5.23", "2000-Q2 0.94 2.42 5.10",
  "2000-Q3 2.24 3.40 5.92", "2000-Q4 2.43 3.07 5.88", "2001-Q1 0.50 3.57 6.39", "2001-Q2 1.01 3.77 6.66", "2001-Q3 0.49 3.59 6.70", "2001-Q4 -0.69 3.23 6.29",
  "2002-Q1 -0.63 2.91 5.23", "2002-Q2 -0.33 3.17 5.39", "2002-Q3 0.86 3.46 5.38", "2002-Q4 1.33 3.84 5.44", "2003-Q1 0.19 3.37 5.57", "2003-Q2 2.12 4.24 5.80",
  "2003-Q3 0.85 3.51 5.86", "2003-Q4 1.44 3.44 5.67", "2004-Q1 0.33 3.36 5.16", "2004-Q2 1.66 3.88 6.00", "2004-Q3 -0.03 3.42 6.07", "2004-Q4 1.81 3.98 6.28",
  "2005-Q1 0.47 2.92 5.74", "2005-Q2 0.22 3.79 6.11", "2005-Q3 1.26 4.31 5.72", "2005-Q4 1.89 3.55 5.89", "2006-Q1 2.07 4.01 6.11", "2006-Q2 1.39 3.15 6.00",
  "2006-Q3 -0.14 3.71 6.01", "2006-Q4 0.36 3.74 6.66", "2007-Q1 -0.77 2.94 6.30", "2007-Q2 -0.00 4.25 6.22", "2007-Q3 1.41 3.95 6.64", "2007-Q4 -0.16 3.62 6.57",
  "2008-Q1 -0.90 2.77 5.88", "2008-Q2 -1.03 2.95 5.89", "2008-Q3 0.47 4.00 5.98", "2008-Q4 -0.86 3.57 5.54", "2009-Q1 0.72 3.87 5.56", "2009-Q2 1.58 3.32 6.13",
  "2009-Q3 -0.75 3.50 5.94", "2009-Q4 -0.30 2.43 5.19", "2010-Q1 -0.18 3.17 5.36", "2010-Q2 0.59 2.97 5.05", "2010-Q3 2.58 3.19 5.22", "2010-Q4 2.33 4.20 5.24",
  "2011-Q1 1.54 3.39 4.96", "2011-Q2 0.44 3.38 5.61", "2011-Q3 0.54 3.17 5.84", "2011-Q4 1.11 3.23 5.89", "2012-Q1 1.23 4.03 6.15", "2012-Q2 2.56 4.67 6.11",
  "2012-Q3 0.61 3.85 6.42", "2012-Q4 1.43 4.14 6.38", "2013-Q1 2.22 4.80 7.10", "2013-Q2 1.52 2.94 6.91", "2013-Q3 1.54 3.27 7.13", "2013-Q4 1.31 3.28 7.11",
  "2014-Q1 0.54 3.33 6.77", "2014-Q2 1.04 2.97 6.54", "2014-Q3 1.25 2.93 6.10", "2014-Q4 1.27 3.44 6.25", "2015-Q1 1.42 2.96 6.23", "2015-Q2 1.52 3.48 6.85",
  "2015-Q3 1.50 3.27 6.46", "2015-Q4 1.03 3.62 7.14", "2016-Q1 -0.04 3.90 6.76", "2016-Q2 -0.44 3.14 6.14", "2016-Q3 -0.37 2.86 5.63", "2016-Q4 -0.35 2.41 5.36",
  "2017-Q1 -0.25 1.40 4.14", "2017-Q2 -0.96 1.79 3.80", "2017-Q3 1.14 2.01 3.90", "2017-Q4 0.38 2.18 4.21", "2018-Q1 -0.74 1.77 3.50", "2018-Q2 0.32 2.06 3.81",
  "2018-Q3 -0.01 1.45 3.63", "2018-Q4 1.09 2.14 4.47", "2019-Q1 0.66 2.75 4.95", "2019-Q2 1.40 2.95 4.95", "2019-Q3 0.55 3.51 5.52", "2019-Q4 0.93 3.13 5.87",
  "2020-Q1 0.98 3.46 6.42", "2020-Q2 1.11 3.84 6.62", "2020-Q3 0.98 3.29 6.62", "2020-Q4 0.52 3.02 6.38", "2021-Q1 -0.13 2.53 6.25", "2021-Q2 0.12 2.24 5.96",
  "2021-Q3 0.89 2.75 5.95", "2021-Q4 -0.76 2.64 6.52", "2022-Q1 2.08 3.73 6.68", "2022-Q2 2.22 4.28 7.03", "2022-Q3 1.03 4.42 7.54", "2022-Q4 0.62 3.65 7.13",
  "2023-Q1 0.90 4.51 7.34", "2023-Q2 0.61 4.56 7.56", "2023-Q3 0.21 4.38 7.79", "2023-Q4 -0.59 4.07 7.42", "2024-Q1 -0.09 4.26 6.96", "2024-Q2 -0.25 4.26 7.66",
  "2024-Q3 0.99 3.74 6.83", "2024-Q4 0.31 2.94 6.75", "2025-Q1 -1.08 3.60 6.85", "2025-Q2 -0.06 3.71 6.53", "2025-Q3 -0.25 3.46 6.45", "2025-Q4 -0.45 3.13 6.55",
].join("\n");

/** Three monthly I(1) series, January 2011 – December 2025, Y = 1 + 0.8 X1 − 0.5 X2 + AR(1) error; seed 2009, 2 decimals. */
export const TS_COINT_DATA_DEFAULT = [
  "Month Y X1 X2",
  "2011-01 17.83 51.23 48.30", "2011-02 18.57 52.50 47.78", "2011-03 17.87 51.33 48.35", "2011-04 18.19 51.06 48.82", "2011-05 17.21 49.08 48.39", "2011-06 17.20 49.82 48.99",
  "2011-07 17.69 49.19 50.23", "2011-08 14.86 48.96 51.73", "2011-09 15.06 49.18 52.44", "2011-10 16.32 49.88 50.75", "2011-11 17.61 49.86 51.53", "2011-12 15.88 50.33 51.04",
  "2012-01 15.97 49.78 51.61", "2012-02 14.79 49.16 49.41", "2012-03 13.69 46.85 49.37", "2012-04 13.40 46.72 51.03", "2012-05 13.77 46.81 50.67", "2012-06 14.64 48.50 48.99",
  "2012-07 13.57 48.43 51.25", "2012-08 14.35 49.43 50.80", "2012-09 15.27 49.51 50.93", "2012-10 16.55 51.40 51.10", "2012-11 18.69 52.55 50.19", "2012-12 19.14 51.95 49.18",
  "2013-01 18.13 50.55 49.73", "2013-02 15.93 50.59 50.03", "2013-03 15.99 50.90 49.71", "2013-04 17.99 54.12 49.40", "2013-05 19.29 53.92 48.57", "2013-06 18.11 53.00 48.17",
  "2013-07 19.58 51.16 46.14", "2013-08 18.88 51.23 46.21", "2013-09 15.77 48.96 47.91", "2013-10 17.68 50.33 47.73", "2013-11 18.39 51.03 46.79", "2013-12 19.00 51.37 47.06",
  "2014-01 18.54 50.46 48.48", "2014-02 18.87 52.18 49.92", "2014-03 17.83 52.28 51.74", "2014-04 18.57 52.27 51.96", "2014-05 17.37 52.22 52.16", "2014-06 16.77 53.47 51.46",
  "2014-07 16.50 52.53 50.70", "2014-08 16.75 51.62 50.41", "2014-09 16.46 51.41 49.39", "2014-10 15.49 51.64 49.15", "2014-11 15.51 51.63 49.85", "2014-12 16.07 50.68 48.51",
  "2015-01 15.33 50.57 49.46", "2015-02 14.34 49.37 48.89", "2015-03 15.48 49.65 50.69", "2015-04 17.40 52.06 49.79", "2015-05 20.49 54.69 48.81", "2015-06 22.06 55.56 47.71",
  "2015-07 21.91 56.28 48.75", "2015-08 21.99 57.31 48.97", "2015-09 23.72 57.36 46.67", "2015-10 24.76 58.21 46.16", "2015-11 23.38 57.88 46.37", "2015-12 25.12 58.48 46.01",
  "2016-01 24.52 59.86 45.45", "2016-02 27.50 60.55 45.66", "2016-03 25.44 58.47 44.79", "2016-04 24.25 57.49 44.47", "2016-05 24.25 57.09 44.44", "2016-06 22.92 55.51 42.81",
  "2016-07 21.79 54.74 45.23", "2016-08 20.43 55.08 46.92", "2016-09 20.69 55.90 47.66", "2016-10 21.83 56.97 48.69", "2016-11 19.95 55.87 50.53", "2016-12 19.70 56.14 50.99",
  "2017-01 21.13 55.92 51.70", "2017-02 20.10 56.64 52.80", "2017-03 21.72 55.49 50.61", "2017-04 21.34 56.07 49.78", "2017-05 21.51 56.27 50.83", "2017-06 24.28 56.84 49.50",
  "2017-07 21.67 57.64 51.13", "2017-08 20.80 58.65 51.10", "2017-09 23.95 58.97 50.89", "2017-10 23.44 58.36 50.96", "2017-11 21.11 57.84 53.08", "2017-12 20.97 58.56 54.71",
  "2018-01 20.02 58.14 56.77", "2018-02 21.14 59.43 56.05", "2018-03 20.77 59.36 55.88", "2018-04 22.74 61.47 56.49", "2018-05 26.18 63.77 54.77", "2018-06 24.97 63.75 54.76",
  "2018-07 22.17 62.84 55.26", "2018-08 22.81 62.02 56.92", "2018-09 21.63 61.92 57.45", "2018-10 21.97 61.79 56.52", "2018-11 24.59 62.24 55.83", "2018-12 24.27 62.27 55.36",
  "2019-01 26.13 62.87 54.63", "2019-02 26.05 61.80 55.26", "2019-03 24.48 62.59 55.25", "2019-04 24.82 62.29 55.48", "2019-05 23.50 62.48 57.17", "2019-06 21.93 59.56 56.73",
  "2019-07 22.49 60.61 56.61", "2019-08 22.06 60.29 57.59", "2019-09 24.74 62.45 56.79", "2019-10 24.76 62.41 56.61", "2019-11 23.08 62.67 56.41", "2019-12 22.89 62.21 55.65",
  "2020-01 23.81 62.01 55.77", "2020-02 21.29 61.10 57.02", "2020-03 22.90 62.67 57.10", "2020-04 21.69 60.99 58.03", "2020-05 21.55 61.72 55.86", "2020-06 21.79 61.92 56.73",
  "2020-07 23.75 62.07 55.92", "2020-08 23.44 61.62 54.92", "2020-09 23.65 61.85 54.27", "2020-10 24.26 62.00 54.40", "2020-11 25.80 61.40 54.96", "2020-12 26.15 61.35 53.97",
  "2021-01 26.27 61.78 54.07", "2021-02 25.47 62.69 54.66", "2021-03 26.76 62.99 53.94", "2021-04 27.24 63.08 54.82", "2021-05 22.49 60.81 55.35", "2021-06 22.57 61.39 53.72",
  "2021-07 18.83 60.41 54.94", "2021-08 21.93 61.94 54.43", "2021-09 19.42 60.62 54.35", "2021-10 21.77 61.26 53.05", "2021-11 22.73 61.82 53.72", "2021-12 21.46 60.48 53.99",
  "2022-01 22.61 62.21 55.91", "2022-02 22.06 62.53 57.66", "2022-03 24.24 62.47 56.19", "2022-04 25.22 63.09 56.41", "2022-05 24.81 63.02 56.06", "2022-06 27.10 65.90 54.93",
  "2022-07 25.87 66.43 54.99", "2022-08 27.26 66.55 53.73", "2022-09 26.32 65.85 53.78", "2022-10 27.41 67.64 53.27", "2022-11 27.98 67.97 53.91", "2022-12 28.07 67.11 54.77",
  "2023-01 30.11 68.60 54.26", "2023-02 28.44 69.24 54.01", "2023-03 27.25 68.54 56.87", "2023-04 26.04 68.39 57.60", "2023-05 29.18 70.40 59.50", "2023-06 29.87 71.35 61.14",
  "2023-07 30.27 72.21 59.93", "2023-08 29.08 71.30 58.79", "2023-09 30.36 70.82 58.26", "2023-10 30.75 71.28 57.98", "2023-11 32.29 72.26 58.07", "2023-12 33.67 73.43 56.86",
  "2024-01 32.79 73.52 58.06", "2024-02 31.66 75.23 57.57", "2024-03 31.43 75.55 57.66", "2024-04 32.28 74.26 58.37", "2024-05 29.22 74.02 58.68", "2024-06 30.14 74.35 57.93",
  "2024-07 30.84 74.38 56.28", "2024-08 30.24 74.66 56.97", "2024-09 28.49 74.55 60.06", "2024-10 29.49 74.61 60.55", "2024-11 28.51 73.45 61.97", "2024-12 28.51 74.31 62.54",
  "2025-01 27.82 74.57 62.66", "2025-02 29.88 74.69 62.13", "2025-03 31.22 74.46 60.73", "2025-04 30.70 74.63 61.14", "2025-05 30.03 74.74 60.59", "2025-06 32.18 75.01 59.51",
  "2025-07 33.94 75.92 58.72", "2025-08 34.24 76.89 59.20", "2025-09 32.82 75.91 61.42", "2025-10 31.88 76.74 62.15", "2025-11 34.63 77.13 60.29", "2025-12 35.76 77.96 60.31",
].join("\n");

// ---------------------------------------------------------------- shared readers

/** A whole-number field in [lo, hi] through the Finance cell reader; blank means `def`. */
function readWhole(read: Read, key: string, label: string, def: number, lo: number, hi: number): number | { error: string } {
  const raw = (read(key) ?? "").trim();
  if (raw === "") return def;
  const v = raw.endsWith("%") ? NaN : readFinanceField(raw);
  if (!Number.isInteger(v) || v < lo || v > hi) return { error: `${label}: ${q(raw)} is not a whole number from ${lo} to ${hi}.` };
  return v;
}

function readTable(read: Read, minRows: number, maxRows: number): { data: SeriesData } | { error: string } {
  const parsed = parseSeriesTable(read("data") ?? "", { minRows });
  if (!parsed.ok) return { error: parsed.reason };
  const data = parsed.data;
  if (data.n > maxRows) {
    return { error: `The series table has ${intText(data.n)} rows; this calculator takes at most ${intText(maxRows)} (use the most recent ${intText(maxRows)}).` };
  }
  const d = data.dates;
  if (d && d.frequency === "irregular") {
    return {
      error: d.gap
        ? `The periods are not evenly spaced: ${d.gap}. A time-series model needs every period; fill the gap.`
        : "The dates mix kinds of period (years, quarters, months or days), so the spacing is not even.",
    };
  }
  return { data };
}

/** The named value columns (comma- or semicolon-separated; blank = every value column), between min and max of them. */
function pickColumns(
  data: SeriesData,
  raw: string,
  min: number,
  max: number,
  what: string,
): { names: string[]; cols: Float64Array[] } | { error: string } {
  const text = (raw ?? "").trim();
  let wanted: string[];
  if (!text) wanted = data.names.slice();
  else if (/[,;]/.test(text)) wanted = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  else if (data.names.some((n) => n.toLowerCase() === text.toLowerCase())) wanted = [text];
  else wanted = text.split(/\s+/).filter(Boolean);
  const names: string[] = [];
  const cols: Float64Array[] = [];
  for (const w of wanted) {
    const p = pickSeries(data, w);
    if (!p.ok) return { error: p.reason };
    if (names.includes(p.name)) return { error: `${q(p.name)} is listed twice.` };
    for (let i = 0; i < p.values.length; i++) if (!Number.isFinite(p.values[i])) return { error: `Row ${i + 1} of ${q(p.name)} is not a finite number.` };
    names.push(p.name);
    cols.push(p.values);
  }
  if (names.length < min) return { error: `${what} needs at least ${min} series; ${names.length === 1 ? `only ${q(names[0])} was given` : `${names.length} were given`}.` };
  if (names.length > max) return { error: `${what} takes at most ${max} series here; ${names.length} were given (${names.map(q).join(", ")}). Name the ones to use in the Columns field.` };
  for (let j = 0; j < cols.length; j++) {
    const c = cols[j];
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < c.length; i++) {
      mn = Math.min(mn, c[i]);
      mx = Math.max(mx, c[i]);
    }
    if (!(mx > mn)) return { error: `${q(names[j])} is constant, so it cannot enter the model.` };
  }
  return { names, cols };
}

/** Plot positions: calendar years from the dates (mid-period), else the observation number. */
function axisOf(data: SeriesData, n: number): { x: number[]; xlabel: string } {
  const d = data.dates;
  if (d) return { x: d.tokens.slice(0, n).map((t) => 1970 + (t.from + t.to) / 2 / 365.2425), xlabel: "Year" };
  return { x: Array.from({ length: n }, (_, i) => i + 1), xlabel: "Observation" };
}

/** Decimals giving about `sig` significant digits for the largest magnitude. */
function colDecimals(values: number[], sig = 5): number {
  let mx = 0;
  for (const v of values) if (Number.isFinite(v)) mx = Math.max(mx, Math.abs(v));
  if (!(mx > 0)) return 3;
  return Math.max(0, Math.min(6, sig - 1 - Math.floor(Math.log10(mx))));
}

const sub = (k: number): string => String(k).replace(/\d/g, (c) => "₀₁₂₃₄₅₆₇₈₉"[Number(c)]);
const LINE_COLORS = ["#0369a1", "#b45309", "#15803d", "#7c3aed", "#be123c", "#334155"];

// ---------------------------------------------------------------- figures (new SVG builders: see the report)

/** Conditional volatility σₜ with |returns| behind it, and the forecast path of √σ²(T + h). */
export function garchVolatilitySvg(o: {
  x: number[];
  absReturn: ArrayLike<number>;
  sigma: ArrayLike<number>;
  forecast: number[];
  xlabel: string;
  title: string;
  ylabel: string;
}): string {
  const n = o.x.length;
  const step = n > 1 ? o.x[n - 1] - o.x[n - 2] : 1;
  const abs: { x: number; y: number }[] = [];
  const sig: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    abs.push({ x: o.x[i], y: o.absReturn[i] });
    sig.push({ x: o.x[i], y: o.sigma[i] });
  }
  const series: Series[] = [
    { type: "line", points: abs, color: "#cbd5e1", label: "|return|" },
    { type: "line", points: sig, color: "#0369a1", label: "conditional σ" },
  ];
  if (o.forecast.length) {
    const fp = [{ x: o.x[n - 1], y: o.sigma[n - 1] }, ...o.forecast.map((v, j) => ({ x: o.x[n - 1] + (j + 1) * step, y: Math.sqrt(v) }))];
    series.push({ type: o.forecast.length === 1 ? "scatter" : "line", points: o.forecast.length === 1 ? fp.slice(1) : fp, color: "#b45309", label: "forecast σ" });
  }
  return buildPlotSvg(series, { width: 460, height: 270, title: o.title, xlabel: o.xlabel, ylabel: o.ylabel });
}

/** Several series against time on one axis (the VAR and Johansen inputs). */
export function seriesLinesSvg(o: { x: number[]; names: string[]; cols: ArrayLike<number>[]; xlabel: string; title: string; ylabel?: string }): string {
  const series: Series[] = o.cols.map((c, j) => ({
    type: "line",
    points: o.x.map((x, i) => ({ x, y: c[i] })),
    color: LINE_COLORS[j % LINE_COLORS.length],
    label: o.names[j],
  }));
  return buildPlotSvg(series, { width: 460, height: 270, title: o.title, xlabel: o.xlabel, ylabel: o.ylabel ?? "Value" });
}

/** A K × K grid of orthogonalized impulse responses (row = response, column = impulse) with ±z·SE bands. */
export function varIrfGridSvg(o: { names: string[]; orth: number[][][]; se: number[][][]; z: number }): string {
  const K = o.names.length;
  const H = o.orth.length - 1;
  // Panel titles "impulse → response" must fit their panel: widen up to 260 px, then shorten long names with "…".
  const CH = 7.2;
  const longest = Math.max(...o.names.map((s) => s.length));
  const base = K <= 2 ? 240 : K === 3 ? 200 : 170;
  const w = Math.min(260, Math.max(base, Math.ceil((2 * longest + 3) * CH) + 24));
  const fit = Math.max(4, Math.floor(((w - 24) / CH - 3) / 2));
  const short = o.names.map((s) => (s.length > fit ? s.slice(0, fit - 1) + "…" : s));
  const h = Math.round(w * 0.7);
  const panels: string[] = [];
  for (let r = 0; r < K; r++)
    for (let c = 0; c < K; c++) {
      const pts = (f: (k: number) => number): { x: number; y: number }[] => Array.from({ length: H + 1 }, (_, k) => ({ x: k, y: f(k) }));
      const series: Series[] = [
        { type: "line", points: pts(() => 0), color: "#94a3b8" },
        { type: "line", points: pts((k) => o.orth[k][r][c] + o.z * o.se[k][r][c]), color: "#7dd3fc" },
        { type: "line", points: pts((k) => o.orth[k][r][c] - o.z * o.se[k][r][c]), color: "#7dd3fc" },
        { type: "line", points: pts((k) => o.orth[k][r][c]), color: "#0369a1" },
      ];
      panels.push(buildPlotSvg(series, { width: w, height: h, title: `${short[c]} → ${short[r]}`, xlabel: r === K - 1 ? "Horizon" : undefined }));
    }
  return composePanels(panels, { cols: K, gap: 6, idPrefix: "irf" }).svg;
}

/** The Engle–Granger residual (the deviation from the cointegrating relation) against time. */
export function egResidualSvg(o: { x: number[]; resid: ArrayLike<number>; xlabel: string; title: string }): string {
  const pts = o.x.map((x, i) => ({ x, y: o.resid[i] }));
  const zero = [{ x: o.x[0], y: 0 }, { x: o.x[o.x.length - 1], y: 0 }];
  return buildPlotSvg(
    [
      { type: "line", points: zero, color: "#94a3b8" },
      { type: "line", points: pts, color: "#0369a1", label: "residual" },
    ],
    { width: 460, height: 260, title: o.title, xlabel: o.xlabel, ylabel: "Residual" },
  );
}

// ---------------------------------------------------------------- ts-garch

const VOL_NAME: Record<GarchVol, string> = { garch: "GARCH(1,1)", gjr: "GJR-GARCH(1,1,1)", egarch: "EGARCH(1,1,1)" };
const VOL_SHORT: Record<GarchVol, string> = { garch: "GARCH", gjr: "GJR-GARCH", egarch: "EGARCH" };
const PARAM_LABEL: Record<string, string> = { mu: "μ (mean)", omega: "ω", alpha: "α₁", gamma: "γ₁", beta: "β₁", nu: "ν (degrees of freedom)" };

export function tsGarchCalc(read: Read): StatOutput {
  const vol = (read("model") ?? "garch").trim() || "garch";
  if (vol !== "garch" && vol !== "gjr" && vol !== "egarch") return refuse(`Unknown volatility model ${q(vol)} (GARCH, GJR-GARCH or EGARCH).`);
  const dist = (read("dist") ?? "normal").trim() || "normal";
  if (dist !== "normal" && dist !== "t") return refuse(`Unknown error distribution ${q(dist)} (normal or Student-t).`);
  const mean = (read("mean") ?? "constant").trim() || "constant";
  if (mean !== "constant" && mean !== "zero") return refuse(`Unknown mean model ${q(mean)} (constant or zero).`);
  const h = readWhole(read, "h", "Forecast horizon", 10, 1, GARCH_MAX_H);
  if (typeof h !== "number") return refuse(h.error);
  const t = readTable(read, GARCH_MIN_N, GARCH_MAX_N);
  if ("error" in t) return refuse(t.error);
  const { data } = t;
  const pick = pickSeries(data, read("column") ?? "");
  if (!pick.ok) return refuse(pick.reason);
  const y = pick.values;
  const name = pick.name;
  const spec = { vol: vol as GarchVol, dist: dist as GarchDist, mean: mean as GarchMean };
  const fit = fitGarch(y, spec);
  if (!fit.ok) return refuse(fit.reason);
  const n = fit.n;
  const k = fit.params.length;
  // Hard rule: estimates are printed only when the first-order (KKT) conditions hold at them, on a bound or not.
  if (!fit.converged && spec.vol === "egarch" && fit.egarchLyapunov >= 0) {
    return refuse(
      `The likelihood maximization did not converge for this series: at the best EGARCH parameters found the recursion is not invertible (the mean of ln|β₁ − (α₁|zₜ| + γ₁zₜ)/2| along the path is ${fmtFixed(fit.egarchLyapunov, 4)}, not below 0; Wintenberger 2013), so the fitted variances depend explosively on the parameters, the likelihood has no smooth maximum, and no estimates are reported. Try GARCH or GJR-GARCH for this series.`,
    );
  }
  // Advice that fits the spec asked for: the other two models, the other error distribution, more data (only when the
  // series is shorter than the most a fit takes).
  const otherModels = (["garch", "gjr", "egarch"] as GarchVol[]).filter((v) => v !== spec.vol).map((v) => VOL_SHORT[v]);
  const otherDist = spec.dist === "t" ? "normal errors" : "Student-t errors";
  const advice = n < GARCH_MAX_N ? `Try ${otherModels.join(" or ")}, ${otherDist}, or a longer series.` : `Try ${otherModels.join(" or ")}, or ${otherDist}.`;
  if (!fit.converged && fit.workLimitHit) {
    return refuse(
      `The likelihood maximization did not converge for this series: the likelihood search hit its work limit before reaching parameters where the first-order conditions hold (largest projected gradient component at the best point found ${Number.isFinite(fit.kktGradient) ? fmtFixed(fit.kktGradient, 4) : "not computable"} per observation), so no estimates are reported. ${advice}`,
    );
  }
  if (!fit.converged) {
    return refuse(
      `The likelihood maximization did not converge for this series: at the best parameters found, the gradient of the log likelihood does not vanish on the free parameters (largest projected component ${Number.isFinite(fit.kktGradient) ? fmtFixed(fit.kktGradient, 4) : "not computable"} per observation), so no estimates are reported. ${advice}`,
    );
  }
  // A quantity that does not fit in a double (a one-step EGARCH forecast past e⁷⁰⁹ in the returns' units, say) is named.
  const nonFinite = !Number.isFinite(fit.llf)
    ? "the log likelihood"
    : fit.params.findIndex((v) => !Number.isFinite(v)) >= 0
    ? `the estimate of ${PARAM_LABEL[fit.names[fit.params.findIndex((v) => !Number.isFinite(v))]]}`
    : !Number.isFinite(fit.persistence)
    ? "the persistence"
    : fit.forecast.slice(0, spec.vol === "egarch" ? 1 : h).some((v) => !Number.isFinite(v))
    ? "the variance forecast"
    : "";
  if (nonFinite) return refuse(`At the estimates, ${nonFinite} is not a finite double-precision number for this series (it overflows), so the result is not reported.`);
  const P = Object.fromEntries(fit.names.map((nm, i) => [nm, fit.params[i]])) as Record<string, number>;
  const aic = -2 * fit.llf + 2 * k;
  const bic = -2 * fit.llf + k * Math.log(n);
  const pct = data.percent[data.names.indexOf(name)];

  const model = `${VOL_NAME[spec.vol]} with ${dist === "t" ? "Student-t" : "normal"} errors and ${mean === "constant" ? "a constant mean" : "a zero mean"}`;
  const lines: string[] = [];
  lines.push(`${model} for ${name} (n = ${intText(n)})`);
  lines.push(`Log likelihood = ${fmtFixed(fit.llf, 3)} · AIC = ${fmtFixed(aic, 3)} · BIC = ${fmtFixed(bic, 3)} (k = ${k} parameters)`);
  const persWord = spec.vol === "garch" ? "α₁ + β₁" : spec.vol === "gjr" ? "α₁ + γ₁/2 + β₁" : "β₁ (persistence of log σ²)";
  // At the stationarity boundary (persistence within 10⁻⁴ of 1, integrated GARCH) the half-life and the unconditional
  // variance are not finite numbers worth printing (ln p → 0 and 1 − p → 0 give 10¹⁵-period half-lives).
  const unitPers = fit.persistence > 1 - 1e-4;
  const disp = (v: number): number => (Math.abs(v) < 5e-5 ? 0 : v);
  let halfLife = "";
  // α₁ on 0 (and α₁ + γ₁ on 0 for GJR), by the same 10⁻⁴ test as the boundary list: returns do not move the variance,
  // which follows a deterministic path from the backcast toward ω/(1 − β₁), the gap shrinking by β₁ each period. A
  // half-life then describes that drift, not a response to shocks (the model has none).
  const noArch =
    (spec.vol === "garch" && fit.atBounds.includes("α = 0")) || (spec.vol === "gjr" && fit.atBounds.includes("α = 0") && fit.atBounds.includes("α + γ = 0"));
  if (noArch) {
    const who = `${spec.vol === "garch" ? "α₁ is" : "α₁ and α₁ + γ₁ are"} on 0 (within 10⁻⁴), so returns do not move the variance`;
    const b = P.beta;
    if (b < 5e-5) halfLife = `; ${who}, and with β₁ = 0 it is constant at ω`;
    else if (b > 1 - 1e-4) halfLife = `; ${who}, and with β₁ at 1 it follows a deterministic path from the starting (backcast) variance, growing by ω each period, with no response to shocks`;
    else {
      const hl = Math.log(0.5) / Math.log(b);
      halfLife = `; ${who}: it follows a deterministic path from the starting (backcast) variance toward ω/(1 − β₁), the gap shrinking by the factor β₁ each period, ${
        hl < 1 ? "so the gap halves within a period" : `with half-life ln 0.5 / ln β₁ = ${fmtFixed(hl, hl < 10 ? 2 : 1)} periods`
      } (the half-life of that drift, not of a response to shocks)`;
    }
  } else if (fit.persistence > 0 && !unitPers) {
    const hl = Math.log(0.5) / Math.log(fit.persistence);
    halfLife =
      hl < 1
        ? "; half-life of a volatility shock = ln 0.5 / ln(persistence) is under 1 period (a shock halves within a period)"
        : `; half-life of a volatility shock = ln 0.5 / ln(persistence) = ${fmtFixed(hl, hl < 10 ? 2 : 1)} periods`;
  } else if (unitPers) halfLife = "; at 1 (integrated volatility): a shock to volatility does not decay, so there is no finite half-life or unconditional variance";
  else halfLife = "; a shock dies out within one period";
  lines.push(`Persistence ${persWord} = ${fmtFixed(fit.persistence, 4)}${halfLife}`);
  if (spec.vol !== "egarch" && !unitPers) {
    const uv = P.omega / (1 - fit.persistence);
    const d = colDecimals([uv], 5);
    lines.push(`Unconditional variance ω/(1 − persistence) = ${fmtFixed(uv, d)} (volatility ${fmtFixed(Math.sqrt(uv), colDecimals([Math.sqrt(uv)], 5))} per period)`);
  }
  if (spec.vol === "gjr") {
    lines.push(
      noArch
        ? "Leverage: none to report, since α₁ and α₁ + γ₁ are on 0 and neither a negative nor a positive return moves the variance."
        : P.gamma > 0
        ? `Leverage: a negative return raises next period's variance by (α₁ + γ₁)ε² = ${fmtFixed(disp(P.alpha + P.gamma), 4)}ε², a positive one by α₁ε² = ${fmtFixed(disp(P.alpha), 4)}ε².`
        : `γ₁ = ${fmtFixed(P.gamma, 4)}: no leverage effect (negative returns do not raise variance more than positive ones).`,
    );
  }
  if (spec.vol === "egarch") {
    lines.push(
      P.gamma < 0
        ? `Leverage: γ₁ = ${fmtFixed(P.gamma, 4)} < 0, so a negative standardized shock raises log variance more than a positive one.`
        : `γ₁ = ${fmtFixed(P.gamma, 4)} ≥ 0: no leverage effect.`,
    );
  }
  const fcN = spec.vol === "egarch" ? 1 : h;
  const fc = fit.forecast.slice(0, fcN);
  const fd = colDecimals(fc, 5);
  lines.push(
    spec.vol === "egarch"
      ? `One-step variance forecast σ²(T + 1) = ${fmtFixed(fc[0], fd)} (volatility ${fmtFixed(Math.sqrt(fc[0]), colDecimals([Math.sqrt(fc[0])], 5))}). EGARCH has no closed-form variance forecast beyond one step (arch forecasts it by simulation), so only h = 1 is given.`
      : `Variance forecast: σ²(T + 1) = ${fmtFixed(fc[0], fd)}, σ²(T + ${fcN}) = ${fmtFixed(fc[fcN - 1], fd)} (σ²(T + h) = ω + persistence·σ²(T + h − 1)${unitPers ? ", growing by ω each period" : ", converging to the unconditional variance"}).`,
  );
  if (fit.atBounds.length) lines.push(`On the boundary of the parameter space: ${fit.atBounds.join("; ")}. Standard errors there are not reliable.`);
  if (!fit.seRobust && fit.seWhy) lines.push(`Standard errors not reported: ${fit.seWhy}.`);
  if (fit.clamped > 0) {
    const nuBound = fit.atBounds.find((b) => b.startsWith("ν = "));
    lines.push(
      `Caution: in ${intText(fit.clamped)} of the ${intText(n)} periods the fitted variance sits on arch's variance bounds (its floor, max(EWMA variance/10⁶, sample variance/10⁸), or above its cap), where the likelihood has a kink rather than a smooth maximum; the estimates may be driven by those periods (a run of zero or repeated returns, say).${nuBound ? ` ν is also on its bound (${nuBound.split(" (")[0]}).` : ""}`,
    );
  }
  if (fit.floored > 0) {
    lines.push(
      `Caution: ${intText(fit.floored)} of the ${intText(n)} periods (${fmtFixed((100 * fit.floored) / n, 1)}%) have a fitted variance at arch's variance floor (on or within a factor of 100 of it), where the likelihood keeps rising as the variance falls; those periods inflate the log likelihood and AIC. Above ${fmtFixed(100 * GARCH_FLOOR_SHARE, 0)}% of the periods the fit is refused as degenerate.`,
    );
  }
  if (fit.higherNonKkt) {
    lines.push(
      `Caution: the search also reached a higher log likelihood at parameters where the first-order conditions do not hold${fit.higherNonKkt.noninvertible ? " (an EGARCH recursion that is not invertible, where the likelihood has no smooth maximum)" : ""}; the estimates above are the highest-likelihood point found that satisfies them.`,
    );
  }
  lines.push("");
  lines.push(
    `Conventions (the arch 8.0 Python package's arch model, with arch's own rescale option off; the rescaling used here is under Estimation): mean model ${mean === "constant" ? "“Constant” (rₜ = μ + εₜ)" : "“Zero” (rₜ = εₜ)"}; εₜ = σₜzₜ with zₜ ${dist === "t" ? "a Student-t scaled to unit variance (ν > 2; arch's StudentsT)" : "standard normal"}.`,
  );
  lines.push(
    spec.vol === "garch"
      ? "Variance: σ²ₜ = ω + α₁ε²ₜ₋₁ + β₁σ²ₜ₋₁ (arch vol=\"GARCH\", p = 1, q = 1)."
      : spec.vol === "gjr"
      ? "Variance: σ²ₜ = ω + (α₁ + γ₁·1[εₜ₋₁ < 0])ε²ₜ₋₁ + β₁σ²ₜ₋₁ (arch vol=\"GARCH\", p = 1, o = 1, q = 1)."
      : "Log variance: ln σ²ₜ = ω + α₁(|zₜ₋₁| − √(2/π)) + γ₁zₜ₋₁ + β₁ ln σ²ₜ₋₁ (arch vol=\"EGARCH\", p = 1, o = 1, q = 1; √(2/π) is used whatever the error distribution, as arch does).",
  );
  lines.push(
    `Start of the recursion: arch's backcast, Σ wᵢ ε̂²ᵢ over the first min(75, n) residuals with weights wᵢ ∝ 0.94ⁱ (ε̂ = ${mean === "constant" ? "rₜ − r̄" : "rₜ"}, fixed during the fit) = ${fmtFixed(spec.vol === "egarch" ? Math.exp(fit.backcast) : fit.backcast, 5)}${spec.vol === "egarch" ? " (its logarithm starts ln σ²)" : spec.vol === "gjr" ? " (the asymmetric term starts at half of it)" : ""}; arch's loose variance bounds are applied in the recursion (computed, like the backcast, on the rescaled series described under Estimation).`,
  );
  lines.push(
    `Estimation: maximum likelihood within arch's bounds and constraints (${spec.vol === "egarch" ? "0 ≤ β₁ ≤ 1" : spec.vol === "gjr" ? "α₁ ≥ 0, α₁ + γ₁ ≥ 0, β₁ ≥ 0, α₁ + γ₁/2 + β₁ ≤ 1" : "α₁ ≥ 0, β₁ ≥ 0, α₁ + β₁ ≤ 1"}${dist === "t" ? ", 2.05 ≤ ν ≤ 500" : ""}), by an active-set quasi-Newton search (BFGS with the exact gradient on the free parameters, a bound kept while the likelihood rises toward it) from several starts, keeping the highest likelihood that satisfies the first-order conditions: arch's three best starting-grid points (by the normal likelihood), a near-iid start (β₁ = 0) and a high-persistence one (${spec.vol === "egarch" ? "β₁ = 0.98" : "persistence 0.98"}, γ₁ = 0)${
      dist === "t" ? ", each with ν from the kurtosis of the standardized residuals (arch's moment start), and ν = 5, 30 and 100 at the best grid point and ν = 30 and 100 at the next two" : ""
    }${
      spec.vol === "egarch"
        ? "; two large-α starts (α₁ = 0.5 with β₁ = 1, α₁ = 1 with β₁ = 0.9; γ₁ = 0); and, when no start satisfies the first-order conditions or a higher likelihood was reached where they fail, eight starts with strong asymmetry (γ₁ = ±0.6 with α₁ = 0.1, 0.3 or 0.5 and β₁ = 0.95, or α₁ = 0.1 and β₁ = 1)"
        : ""
    }. A fit with more than ${fmtFixed(100 * GARCH_FLOOR_SHARE, 0)}% of its periods at arch's variance floor (on or within a factor of 100 of it) is not used (its likelihood grows without limit as the floor is lowered). The search runs on the returns divided by their root mean squared residual (so that series has mean squared residual 1 and is the same series, to rounding, whatever units the returns are typed in), with arch's setup computed on it; every estimate, the log likelihood (+ n ln c) and the standard errors (by the Jacobian of that linear map) are converted back exactly, so neither the estimates nor the checks depend on the units. Estimates are reported only when the first-order (KKT) conditions hold: the gradient of −log L/n (in those units) on the free parameters is below 10⁻⁵ and on each bound it points out of the parameter space${spec.vol === "egarch" && mean === "constant" ? " (for μ, whose |rₜ − μ| term has a kink at each return, the one-sided slopes are checked)" : ""}.`,
  );
  lines.push(
    "Standard errors: robust (Bollerslev–Wooldridge 1992) sandwich H⁻¹SH⁻¹/n, H the numerical Hessian of −log L/n and S the sample covariance (n − 1 divisor) of the per-observation scores, exactly as arch's robust covariance option computes them, with the numerical-derivative steps taken on the rescaled series' parameters (so the last digits can differ from arch run on the returns as typed); the classic column is H⁻¹/n. z and p from the normal distribution.",
  );
  lines.push("Information criteria (arch's definitions): AIC = −2 log L + 2k, BIC = −2 log L + k ln n.");
  lines.push(
    pct
      ? "Units: the returns carry % signs, so they are in percent (1.2 = 1.2%); variances are in %² and volatilities in %."
      : "Units: the returns are read as typed; variances are in their squared units. arch recommends returns in percent (100 × the decimal return).",
  );
  if (data.dates?.frequency === "day") lines.push("Daily dates are treated as consecutive observations (trading days), whatever the calendar gaps.");
  lines.push(...data.notes);

  // Parameter table.
  const rows: string[][] = [["Parameter", "Estimate", "Robust SE", "z", "p", "Classic SE"]];
  fit.names.forEach((nm, i) => {
    const est = fit.params[i];
    const se = fit.seRobust?.[i];
    const sc = fit.seClassic?.[i];
    const d = nm === "nu" ? 3 : Math.max(4, colDecimals([est, se ?? 0], 4));
    const z = se ? est / se : NaN;
    rows.push([PARAM_LABEL[nm], fmtFixed(est, d), se ? fmtFixed(se, d) : "", Number.isFinite(z) ? fmtFixed(z, 3) : "", Number.isFinite(z) ? fmtP(normalP(z)) : "", sc ? fmtFixed(sc, d) : ""]);
  });
  const tables: StatTable[] = [
    {
      label: `${VOL_NAME[spec.vol]}: ${name}`,
      rows,
      align: ["left", "right", "right", "right", "right", "right"],
      note: "z = estimate / robust SE, two-sided p from the normal distribution (as arch's summary reports them).",
    },
  ];
  const fRows: string[][] = [["h", "Variance σ²", "Volatility σ"]];
  const vd = colDecimals(fc.map(Math.sqrt), 5);
  fc.forEach((v, j) => fRows.push([String(j + 1), fmtFixed(v, fd), fmtFixed(Math.sqrt(v), vd)]));
  tables.push({
    label: `Variance forecast for ${name}, ${fcN} period${fcN === 1 ? "" : "s"} ahead`,
    rows: fRows,
    align: ["right", "right", "right"],
    note: spec.vol === "egarch" ? "EGARCH: one step only (no closed form beyond it)." : "Analytic forecast from the last observation (arch method=\"analytic\").",
  });
  const ax = axisOf(data, n);
  const absR = Float64Array.from(fit.resid, Math.abs);
  const sigma = Float64Array.from(fit.sigma2, Math.sqrt);
  const svg = garchVolatilitySvg({ x: ax.x, absReturn: absR, sigma, forecast: fc, xlabel: ax.xlabel, title: `${VOL_NAME[spec.vol]} conditional volatility`, ylabel: pct ? `${name} (%)` : name });
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------- VAR shared

interface VarSetup {
  data: SeriesData;
  names: string[];
  cols: Float64Array[];
  rows: LagOrderRow[];
  sel: { aic: number; bic: number; hqic: number; fpe: number };
  maxlags: number;
  p: number;
  how: string;
  fit: VarFit;
  notes: string[];
}

const CRIT_NAME: Record<string, string> = { aic: "AIC", bic: "BIC", hqic: "HQ", fpe: "FPE" };

function varSetup(read: Read, needTable: boolean): VarSetup | { error: string } {
  const t = readTable(read, 12, VAR_MAX_N);
  if ("error" in t) return t;
  const { data } = t;
  const pc = pickColumns(data, read("columns") ?? "", 2, VAR_MAX_K, "A VAR");
  if ("error" in pc) return pc;
  const { names, cols } = pc;
  const K = names.length;
  const n = data.n;
  const est = varMaxEstimable(n, K);
  const pRaw = ((read("p") ?? "aic").trim() || "aic").toLowerCase();
  // The largest lag matters only for the lag-order table or a criterion; with p entered, ts-var-irf ignores it.
  const useCriteria = needTable || pRaw in CRIT_NAME;
  let ml = 0;
  if (useCriteria) {
    const mlv = readWhole(read, "maxlags", "Largest lag for the lag-order criteria", Math.min(8, Math.max(1, est)), 1, VAR_MAX_P);
    if (typeof mlv !== "number") return mlv;
    if (mlv > est) {
      return {
        error: `The largest lag for the lag-order criteria can be at most ${Math.max(est, 0)} for ${intText(n)} rows and ${K} series ((n − K − 1) ÷ (K + 1), statsmodels' limit, so that VAR(maxlags) can be estimated).`,
      };
    }
    ml = mlv;
  }
  const so = useCriteria ? varSelectOrder(cols, ml) : { rows: [] as LagOrderRow[], selected: { aic: -1, bic: -1, hqic: -1, fpe: -1 } };
  if ("ok" in so) return { error: so.reason };
  const notes: string[] = [];
  let p: number;
  let how: string;
  if (pRaw in CRIT_NAME) {
    p = so.selected[pRaw as keyof typeof so.selected];
    how = `chosen by ${CRIT_NAME[pRaw]} from p = 0…${ml}`;
    if (p === 0) {
      p = 1;
      notes.push(`${CRIT_NAME[pRaw]} chooses p = 0 (no dynamics); the VAR is fitted with p = 1 so the tests and responses exist.`);
      how = `${CRIT_NAME[pRaw]} chose 0; p = 1 used`;
    }
  } else {
    const pv = readWhole(read, "p", "Lag order p", 1, 1, VAR_MAX_P);
    if (typeof pv !== "number") return pv;
    p = pv;
    how = "as entered";
  }
  const T = n - p;
  if (T - (K * p + 1) < K + 1) {
    return { error: `VAR(${p}) with ${K} series needs more than ${K * p + 1 + K} observations after the ${p} lag${p === 1 ? "" : "s"}; the table has ${intText(T)}.` };
  }
  const fit = fitVarOls(cols, p);
  if (!fit) return { error: `The VAR(${p}) regression is singular (a series is constant or an exact combination of the others).` };
  if (!fit.sigmaU.every((r) => r.every(Number.isFinite)) || !fit.B.every((r) => r.every(Number.isFinite))) {
    return { error: "A fitted quantity is not a finite number for these series (an extreme scale), so the result is not reported." };
  }
  return { data, names, cols, rows: so.rows, sel: so.selected, maxlags: ml, p, how, fit, notes };
}

function lagOrderTable(s: VarSetup): StatTable {
  const so = { rows: s.rows };
  const fd = colDecimals(so.rows.map((r) => r.fpe), 5);
  const rows: string[][] = [["p", "AIC", "BIC", "HQ", "FPE"]];
  for (const r of so.rows) {
    const star = (key: keyof typeof s.sel): string => (s.sel[key] === r.p ? "*" : "");
    const fpe = Math.abs(r.fpe) < 1e-3 || Math.abs(r.fpe) >= 1e6 ? fmtSci(r.fpe) : fmtFixed(r.fpe, fd);
    rows.push([String(r.p), fmtFixed(r.aic, 4) + star("aic"), fmtFixed(r.bic, 4) + star("bic"), fmtFixed(r.hqic, 4) + star("hqic"), fpe + star("fpe")]);
  }
  return {
    label: `Lag-order selection (p = 0…${s.maxlags}, common sample of ${intText(s.data.n - s.maxlags)} observations)`,
    rows,
    align: ["right", "right", "right", "right", "right"],
    note: "* marks each criterion's minimum. AIC, BIC, HQ = ln|Σ̂ᵤ| + c·(pK² + K)/T with c = 2, ln T, 2 ln ln T; FPE = ((T + Kp + 1)/(T − Kp − 1))ᴷ|Σ̂ᵤ| (statsmodels' lag-order selection).",
  };
}

function varConventions(s: VarSetup): string[] {
  return [
    `Conventions (statsmodels 0.15 VAR, trend="c"): each equation by OLS on a constant and lags 1…p of every series; Σᵤ = ε̂ᵀε̂/(T − Kp − 1) (statsmodels' residual covariance); T = n − p = ${intText(s.fit.nobs)}.`,
    s.rows.length
      ? `Lag order: ${s.how}. The criteria compare every p on the same ${intText(s.data.n - s.maxlags)} observations (the first ${s.maxlags} rows held back), with the maximum-likelihood Σ̂ᵤ = ε̂ᵀε̂/T.`
      : `Lag order: p = ${s.p}, as entered.`,
  ];
}

// ---------------------------------------------------------------- ts-var

export function tsVarCalc(read: Read): StatOutput {
  const s = varSetup(read, true);
  if ("error" in s) return refuse(s.error);
  const { names, fit } = s;
  const K = names.length;
  const p = fit.p;
  const lines: string[] = [];
  lines.push(`VAR(${p}) with a constant for ${names.map(q).join(", ")} (n = ${intText(s.data.n)}; T = ${intText(fit.nobs)} after the lags)`);
  lines.push(`Lag order selected: AIC ${s.sel.aic}, BIC ${s.sel.bic}, HQ ${s.sel.hqic}, FPE ${s.sel.fpe}; p = ${p} (${s.how}).`);
  const root = varMaxRoot(fit);
  if (root !== null) {
    lines.push(
      root < 1
        ? `Stable: the largest companion-matrix eigenvalue has modulus ${fmtFixed(root, 4)} < 1.`
        : `Not stable: the largest companion-matrix eigenvalue has modulus ${fmtFixed(root, 4)} ≥ 1, so impulse responses do not die out (difference the series or test for cointegration).`,
    );
  }
  const gr = [];
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) if (i !== j) gr.push(varGranger(fit, i, j));
  const sig = gr.filter((g) => g.p < 0.05);
  lines.push(
    sig.length
      ? `Granger causality at 5%: ${sig.map((g) => `${names[g.causing]} → ${names[g.caused]} (p ${g.p < 0.001 ? fmtP(g.p) : `= ${fmtP(g.p)}`})`).join("; ")}.`
      : "Granger causality at 5%: no series helps predict another beyond its own lags.",
  );
  lines.push(...s.notes);
  lines.push("");
  lines.push(...varConventions(s));
  lines.push(
    `Coefficient SEs from Cov(vec B) = (ZᵀZ)⁻¹ ⊗ Σᵤ; z and p from the normal distribution (statsmodels VARResults.pvalues). Granger F: the Wald statistic for the p lags of the causing series in the caused series' equation, divided by p, against the F distribution with p and K(T − Kp − 1) degrees of freedom, here ${p} and ${intText(K * fit.dfResid)} (statsmodels' Granger causality F test).`,
  );
  lines.push(...s.data.notes);

  const tables: StatTable[] = [lagOrderTable(s)];
  const bd = colDecimals(fit.B.flat(), 4);
  for (let e = 0; e < K; e++) {
    const rows: string[][] = [["Term", "Coefficient", "SE", "z", "p"]];
    for (let r = 0; r < fit.B.length; r++) {
      const est = fit.B[r][e];
      const se = Math.sqrt(fit.xtxInv[r][r] * fit.sigmaU[e][e]);
      const label = r === 0 ? "Constant" : `${names[(r - 1) % K]}, lag ${Math.floor((r - 1) / K) + 1}`;
      const z = est / se;
      const d = Math.max(4, bd);
      rows.push([label, fmtFixed(est, d), fmtFixed(se, d), fmtFixed(z, 3), fmtP(normalP(z))]);
    }
    tables.push({ label: `Equation for ${names[e]}`, rows, align: ["left", "right", "right", "right", "right"] });
  }
  const gRows: string[][] = [["Caused", "Causing", "F", "df₁", "df₂", "p"]];
  for (const g of gr) gRows.push([names[g.caused], names[g.causing], fmtFixed(g.F, 3), intText(g.df1), intText(g.df2), fmtP(g.p)]);
  tables.push({ label: "Granger causality (F tests)", rows: gRows, align: ["left", "left", "right", "right", "right", "right"], note: "H₀: the causing series' lags do not enter the caused series' equation." });
  const sd = colDecimals(fit.sigmaU.flat(), 4);
  const sRows: string[][] = [["Σᵤ", ...names]];
  fit.sigmaU.forEach((r, i) => sRows.push([names[i], ...r.map((v) => fmtFixed(v, Math.max(4, sd)))]));
  tables.push({ label: "Residual covariance Σᵤ (degrees-of-freedom corrected)", rows: sRows, align: ["left", ...names.map(() => "right" as const)] });
  const ax = axisOf(s.data, s.data.n);
  const svg = seriesLinesSvg({ x: ax.x, names, cols: s.cols, xlabel: ax.xlabel, title: `VAR(${p}) input series` });
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------- ts-var-irf

export function tsVarIrfCalc(read: Read): StatOutput {
  const H = readWhole(read, "h", "Impulse-response horizon", 10, 1, VAR_MAX_H);
  if (typeof H !== "number") return refuse(H.error);
  const s = varSetup(read, false);
  if ("error" in s) return refuse(s.error);
  const { names, fit } = s;
  const K = names.length;
  const ir = varIrf(fit, H);
  if ("ok" in ir) return refuse(ir.reason);
  const all = [...ir.orth.flat(2), ...ir.se.flat(2), ...ir.fevd.flat(2)];
  if (!all.every(Number.isFinite)) return refuse("An impulse response or its standard error is not a finite number (the VAR is explosive at this horizon); shorten the horizon or difference the series.");
  const z = 1.959963984540054;
  const lines: string[] = [];
  lines.push(`Orthogonalized impulse responses and FEVD from a VAR(${fit.p}) for ${names.map(q).join(", ")} (T = ${intText(fit.nobs)}), horizon ${H}`);
  lines.push(`Cholesky ordering: ${names.join(" → ")} (a shock to an earlier series moves later ones on impact, not the reverse). Change the order in the Columns field.`);
  const root = varMaxRoot(fit);
  if (root !== null && root >= 1) lines.push(`Warning: the VAR is not stable (largest root modulus ${fmtFixed(root, 4)} ≥ 1), so the responses do not die out.`);
  for (let r = 0; r < K; r++) {
    const last = ir.fevd[r][H - 1];
    const own = last[r];
    lines.push(`FEVD of ${names[r]} at h = ${H}: ${names.map((nm, c) => `${nm} ${fmtFixed(100 * last[c], 1)}%`).join(", ")}${own > 0.5 ? "" : " (mostly driven by other series)"}.`);
  }
  lines.push(...s.notes);
  lines.push("");
  lines.push(...varConventions(s));
  lines.push(
    "Impulse: one standard deviation of the orthogonalized shock, Θₕ = ΦₕP with P the lower Cholesky factor of Σᵤ (statsmodels irf()). Bands: asymptotic, ±1.96 SE, the delta-method standard errors of Lütkepohl (2005, Prop. 3.6) as statsmodels IRAnalysis.stderr(orth=True) computes them (no bootstrap, so nothing random).",
  );
  lines.push(
    "FEVD (statsmodels fevd): the share of the h-step forecast-error variance of each series due to each orthogonalized shock, (sum over s < h of Θ²ₛ) ÷ (sum over s < h of the diagonal of ΦₛΣᵤΦₛᵀ); h = 1 is the impact period.",
  );
  lines.push(...s.data.notes);

  const tables: StatTable[] = [];
  const dec = Math.max(3, colDecimals(ir.orth.flat(2), 3));
  for (let c = 0; c < K; c++) {
    const rows: string[][] = [["h", ...names]];
    for (let k = 0; k <= H; k++) rows.push([String(k), ...names.map((_, r) => `${fmtFixed(ir.orth[k][r][c], dec)} (${fmtFixed(ir.se[k][r][c], dec)})`)]);
    tables.push({
      label: `Responses to a one-SD shock in ${names[c]}`,
      rows,
      align: ["right", ...names.map(() => "right" as const)],
      note: "Asymptotic standard errors in parentheses; 95% band = response ± 1.96 SE.",
    });
  }
  for (let r = 0; r < K; r++) {
    const rows: string[][] = [["h", ...names.map((nm) => `${nm} (%)`)]];
    for (let k = 0; k < H; k++) rows.push([String(k + 1), ...ir.fevd[r][k].map((v) => fmtFixed(100 * v, 2))]);
    tables.push({ label: `FEVD of ${names[r]}: share of forecast-error variance from each shock`, rows, align: ["right", ...names.map(() => "right" as const)], note: "Each row sums to 100%." });
  }
  const svg = varIrfGridSvg({ names, orth: ir.orth, se: ir.se, z });
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------- ts-engle-granger

export function tsEngleGrangerCalc(read: Read): StatOutput {
  const trend = (read("trend") ?? "c").trim() || "c";
  if (trend !== "c" && trend !== "ct") return refuse(`Unknown deterministic option ${q(trend)} (constant, or constant and trend).`);
  const t = readTable(read, 20, COINT_MAX_N);
  if ("error" in t) return refuse(t.error);
  const { data } = t;
  const pc = pickColumns(data, read("columns") ?? "", 2, COINT_MAX_K, "The Engle–Granger test");
  if ("error" in pc) return refuse(pc.error);
  const { names, cols } = pc;
  const K = names.length;
  const n = data.n;
  const r = engleGranger(cols[0], cols.slice(1), trend as CointTrend);
  if (!r.ok) return refuse(r.reason);
  if (![r.stat, r.p, ...r.crit, ...r.coef].every(Number.isFinite)) return refuse("A test quantity is not a finite number for these series, so the result is not reported.");
  const reject = r.stat < r.crit[1];
  const lines: string[] = [];
  lines.push(`Engle–Granger cointegration test: ${q(names[0])} on ${names.slice(1).map(q).join(", ")} with ${trend === "c" ? "a constant" : "a constant and a linear trend"} (n = ${intText(n)}, N = ${K} variables)`);
  lines.push(`Residual ADF τ = ${fmtFixed(r.stat, 4)}, MacKinnon p ${r.p < 0.001 ? fmtP(r.p) : `= ${fmtP(r.p)}`}; critical values 1% ${fmtFixed(r.crit[0], 3)}, 5% ${fmtFixed(r.crit[1], 3)}, 10% ${fmtFixed(r.crit[2], 3)}.`);
  lines.push(
    reject
      ? "At 5% the null of no cointegration is rejected: the series share a common stochastic trend (the residual is stationary)."
      : "At 5% the null of no cointegration is not rejected.",
  );
  lines.push(`ADF lag ${r.usedLag} chosen by AIC from 0…${r.maxLag} (Schwert's rule), on ${intText(r.adfNobs)} residual differences.`);
  lines.push("");
  lines.push(
    `Conventions (statsmodels 0.15 coint, method="aeg", autolag="aic"): OLS of the first series on the others plus ${trend === "c" ? "a constant" : "a constant and trend t = 1…n"}; ADF regression on the residuals with no deterministic terms ("n").`,
  );
  lines.push(
    `p-value: MacKinnon (1994) cointegration surface for N = ${K} (not the one-series ADF table); critical values: MacKinnon (2010) for N = ${K} at T = n − 1 = ${intText(n - 1)} (statsmodels' choice, matching Stata's egranger). The first series is the dependent one; the test can differ if another series is put first.`,
  );
  lines.push("The cointegrating coefficients are superconsistent but their usual OLS standard errors are not valid (non-standard distribution), so none are printed.");
  lines.push(...data.notes);
  const cd = Math.max(4, colDecimals(r.coef, 4));
  const coefRows: string[][] = [["Term", "Coefficient"]];
  coefRows.push(["Constant", fmtFixed(r.coef[0], cd)]);
  let i = 1;
  if (trend === "ct") coefRows.push(["Trend (per period)", fmtFixed(r.coef[i++], cd)]);
  for (let j = 1; j < K; j++) coefRows.push([names[j], fmtFixed(r.coef[i++], cd)]);
  coefRows.push(["R²", fmtFixed(r.r2, 4)]);
  const tables: StatTable[] = [
    { label: `Cointegrating regression: ${names[0]}`, rows: coefRows, align: ["left", "right"] },
    {
      label: "Engle–Granger test",
      rows: [
        ["Statistic", "τ", "p", "1%", "5%", "10%"],
        ["Residual ADF", fmtFixed(r.stat, 4), fmtP(r.p), fmtFixed(r.crit[0], 3), fmtFixed(r.crit[1], 3), fmtFixed(r.crit[2], 3)],
      ],
      align: ["left", "right", "right", "right", "right", "right"],
      note: `H₀: no cointegration. Reject when τ is below the critical value. N = ${K}.`,
    },
  ];
  const ax = axisOf(data, n);
  const svg = egResidualSvg({ x: ax.x, resid: r.resid, xlabel: ax.xlabel, title: `Cointegrating residual: ${names[0]}` });
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------- ts-johansen

const DET_TEXT: Record<string, string> = {
  "-1": "no deterministic terms (statsmodels deterministic order −1)",
  "0": "a constant (statsmodels deterministic order 0)",
  "1": "a linear trend (statsmodels deterministic order 1)",
};

export function tsJohansenCalc(read: Read): StatOutput {
  const detRaw = ((read("det") ?? "0").trim() || "0").replace(MINUS, "-");
  if (detRaw !== "-1" && detRaw !== "0" && detRaw !== "1") return refuse(`Unknown deterministic option ${q(detRaw)} (−1, 0 or 1).`);
  const det = Number(detRaw) as JohansenDet;
  const kd = readWhole(read, "kdiff", "Lagged differences k", 1, 0, JOHANSEN_MAX_KDIFF);
  if (typeof kd !== "number") return refuse(kd.error);
  const t = readTable(read, 20, COINT_MAX_N);
  if ("error" in t) return refuse(t.error);
  const { data } = t;
  const pc = pickColumns(data, read("columns") ?? "", 2, COINT_MAX_K, "The Johansen test");
  if ("error" in pc) return refuse(pc.error);
  const { names, cols } = pc;
  const K = names.length;
  const n = data.n;
  const T = n - 1 - kd;
  if (T - K * kd - 1 < K + 2) {
    return refuse(`With ${K} series and k = ${kd} lagged differences the Johansen regressions need more than ${K * kd + K + 3} usable rows; the table leaves ${intText(T)}. Use fewer lags or a longer series.`);
  }
  const r = johansen(cols, det, kd);
  if (!r.ok) return refuse(r.reason);
  if (![...r.eig, ...r.trace, ...r.maxEig].every(Number.isFinite)) return refuse("A test quantity is not a finite number for these series, so the result is not reported.");
  let rankTrace = K;
  for (let i = 0; i < K; i++) if (r.trace[i] < r.cvt[i][1]) {
    rankTrace = i;
    break;
  }
  let rankMax = K;
  for (let i = 0; i < K; i++) if (r.maxEig[i] < r.cvm[i][1]) {
    rankMax = i;
    break;
  }
  const lines: string[] = [];
  lines.push(`Johansen cointegration test for ${names.map(q).join(", ")} with ${DET_TEXT[detRaw]}, k = ${kd} lagged difference${kd === 1 ? "" : "s"} (n = ${intText(n)}, T = ${intText(r.T)})`);
  lines.push(`Cointegrating rank at 5%: ${rankTrace} by the trace test, ${rankMax} by the maximum-eigenvalue test${rankTrace === K ? " (full rank: the series look stationary in levels)" : ""}.`);
  lines.push(`Eigenvalues: ${r.eig.map((v) => fmtFixed(v, 4)).join(", ")}.`);
  lines.push("");
  lines.push(
    `Conventions (statsmodels 0.15 Johansen test, deterministic order ${det < 0 ? `${MINUS}1` : det}, ${kd} lagged difference${kd === 1 ? "" : "s"}): ${det === -1 ? "no detrending" : det === 0 ? "the levels are demeaned" : "the levels are linearly detrended"}; ${det >= 0 ? "the differences, their lags and the lagged levels are then demeaned" : "nothing else is detrended"} (statsmodels' convention, f = ${det >= 0 ? "0" : `${MINUS}1`}). ΔXₜ and the lagged level Xₜ₋ₖ are each regressed on ΔXₜ₋₁…ΔXₜ₋ₖ; the eigenvalues solve |λSₖₖ − Sₖ₀S₀₀⁻¹S₀ₖ| = 0 (moments divided by T).`,
  );
  lines.push("Trace = −T Σ ln(1 − λᵢ) over i > r; maximum eigenvalue = −T ln(1 − λᵣ₊₁). Critical values: Osterwald-Lenum (1992), as statsmodels' trace and maximum-eigenvalue critical-value tables give them (asymptotic, 90%, 95%, 99%).");
  lines.push(`k counts lagged differences, so it corresponds to a VAR in levels with p = k + 1 = ${kd + 1} lags.`);
  lines.push(...data.notes);
  const rowsFor = (stat: number[], cv: number[][], label: string): string[][] => {
    const rows: string[][] = [[label === "Trace" ? "H₀: rank ≤ r" : "H₀: rank = r", "Eigenvalue", label, "90%", "95%", "99%"]];
    for (let i = 0; i < K; i++) rows.push([`r = ${i}`, fmtFixed(r.eig[i], 4), fmtFixed(stat[i], 3) + (stat[i] > cv[i][1] ? "*" : ""), fmtFixed(cv[i][0], 3), fmtFixed(cv[i][1], 3), fmtFixed(cv[i][2], 3)]);
    return rows;
  };
  const tables: StatTable[] = [
    { label: "Johansen trace test", rows: rowsFor(r.trace, r.cvt, "Trace"), align: ["left", "right", "right", "right", "right", "right"], note: "* rejects H₀ at 5% (the statistic exceeds the 95% critical value)." },
    { label: "Johansen maximum-eigenvalue test", rows: rowsFor(r.maxEig, r.cvm, "Max-eigen"), align: ["left", "right", "right", "right", "right", "right"], note: "* rejects H₀: rank = r against rank = r + 1 at 5%." },
  ];
  const ax = axisOf(data, n);
  const svg = seriesLinesSvg({ x: ax.x, names, cols, xlabel: ax.xlabel, title: "Series in levels" });
  return { text: lines.join("\n"), tables, svg };
}

// ---------------------------------------------------------------- registry

const LAG_OPTIONS = [
  { value: "aic", label: "Chosen by AIC" },
  { value: "bic", label: "Chosen by BIC" },
  { value: "hqic", label: "Chosen by HQ" },
  { value: "fpe", label: "Chosen by FPE" },
  ...Array.from({ length: VAR_MAX_P }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
];
const DATA_LABEL = "Series table: dates or periods in the first column (optional), then the value columns";

export const TS2_STAT_CALCS: StatCalcDef[] = [
  {
    id: "ts-garch",
    name: "GARCH volatility model (GARCH, GJR, EGARCH)",
    fields: [
      { key: "data", label: "Returns table (percent returns recommended): dates or periods first (optional), then one or more value columns", default: TS_GARCH_DATA_DEFAULT, kind: "block" },
      { key: "column", label: "Column of returns (blank when the table has one value column)", default: "", kind: "text" },
      {
        key: "model",
        label: "Volatility model",
        default: "gjr",
        kind: "select",
        options: [
          { value: "garch", label: "GARCH(1,1)" },
          { value: "gjr", label: "GJR-GARCH(1,1,1) (leverage)" },
          { value: "egarch", label: "EGARCH(1,1,1)" },
        ],
      },
      {
        key: "dist",
        label: "Error distribution",
        default: "t",
        kind: "select",
        options: [
          { value: "normal", label: "Normal" },
          { value: "t", label: "Student-t" },
        ],
      },
      {
        key: "mean",
        label: "Mean model",
        default: "constant",
        kind: "select",
        options: [
          { value: "constant", label: "Constant" },
          { value: "zero", label: "Zero" },
        ],
      },
      { key: "h", label: `Variance forecast horizon (periods, 1–${GARCH_MAX_H}; EGARCH gives 1)`, default: "10", kind: "text" },
    ],
    compute: (r) => {
      // GARCH-family maximum likelihood with robust SEs, persistence, half-life, variance forecast and the volatility figure.
      return tsGarchCalc(r);
    },
  },
  {
    id: "ts-var",
    name: "VAR(p): lag order, estimates, Granger causality",
    fields: [
      { key: "data", label: DATA_LABEL, default: TS_VAR_DATA_DEFAULT, kind: "block" },
      { key: "columns", label: `Columns to model, in order, separated by commas (blank = every value column; 2–${VAR_MAX_K})`, default: "", kind: "text" },
      { key: "p", label: "Lag order p", default: "aic", kind: "select", options: LAG_OPTIONS },
      { key: "maxlags", label: `Largest lag in the lag-order table (1–${VAR_MAX_P})`, default: "8", kind: "text" },
    ],
    compute: (r) => {
      // Lag-order criteria, OLS VAR estimates by equation, pairwise Granger F tests and the residual covariance.
      return tsVarCalc(r);
    },
  },
  {
    id: "ts-var-irf",
    name: "VAR impulse responses and variance decomposition",
    fields: [
      { key: "data", label: DATA_LABEL, default: TS_VAR_DATA_DEFAULT, kind: "block" },
      { key: "columns", label: `Columns in Cholesky order, separated by commas (blank = table order; 2–${VAR_MAX_K})`, default: "", kind: "text" },
      { key: "p", label: "Lag order p", default: "aic", kind: "select", options: LAG_OPTIONS },
      { key: "maxlags", label: `Largest lag considered when p is chosen by a criterion (1–${VAR_MAX_P})`, default: "8", kind: "text" },
      { key: "h", label: `Horizon (periods, 1–${VAR_MAX_H})`, default: "10", kind: "text" },
    ],
    compute: (r) => {
      // Orthogonalised impulse responses with asymptotic 95% bands, the response grid figure and the FEVD tables.
      return tsVarIrfCalc(r);
    },
  },
  {
    id: "ts-engle-granger",
    name: "Engle–Granger cointegration test",
    fields: [
      { key: "data", label: DATA_LABEL, default: TS_COINT_DATA_DEFAULT, kind: "block" },
      { key: "columns", label: `Columns, dependent series first, separated by commas (blank = table order; 2–${COINT_MAX_K})`, default: "", kind: "text" },
      {
        key: "trend",
        label: "Deterministic terms in the cointegrating regression",
        default: "c",
        kind: "select",
        options: [
          { value: "c", label: "Constant" },
          { value: "ct", label: "Constant and linear trend" },
        ],
      },
    ],
    compute: (r) => {
      // Cointegrating regression, residual ADF with MacKinnon N-variable p-value and critical values, residual figure.
      return tsEngleGrangerCalc(r);
    },
  },
  {
    id: "ts-johansen",
    name: "Johansen cointegration test (trace and maximum eigenvalue)",
    fields: [
      { key: "data", label: DATA_LABEL, default: TS_COINT_DATA_DEFAULT, kind: "block" },
      { key: "columns", label: `Columns, separated by commas (blank = every value column; 2–${COINT_MAX_K})`, default: "", kind: "text" },
      {
        key: "det",
        label: "Deterministic terms",
        default: "0",
        kind: "select",
        options: [
          { value: "-1", label: "None (deterministic order −1)" },
          { value: "0", label: "Constant (deterministic order 0)" },
          { value: "1", label: "Linear trend (deterministic order 1)" },
        ],
      },
      {
        key: "kdiff",
        label: "Lagged differences k (VAR lags − 1)",
        default: "1",
        kind: "select",
        options: Array.from({ length: JOHANSEN_MAX_KDIFF + 1 }, (_, i) => ({ value: String(i), label: String(i) })),
      },
    ],
    compute: (r) => {
      // Trace and maximum-eigenvalue statistics with Osterwald-Lenum critical values and the rank at 5%.
      return tsJohansenCalc(r);
    },
  },
];
