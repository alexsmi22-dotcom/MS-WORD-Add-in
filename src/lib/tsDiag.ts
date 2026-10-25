/**
 * Release E3a: time-series diagnostics engines, each pinned to statsmodels 0.15 (read from its source, BSD-3):
 *
 *  - acfBiased / acfBands    statsmodels.tsa.stattools.acf(x, adjusted=False, alpha=0.05): autocovariances over n,
 *                            Bartlett bands ±z·√((1 + 2Σ_{j<k} r_j²)/n).
 *  - pacfYwAdjusted          statsmodels' pacf default in 0.15, method "ywadjusted": Yule–Walker on the autocovariances
 *                            with divisor n − k, solved order by order (Levinson–Durbin gives the same solution).
 *  - ljungBox                statsmodels.stats.diagnostic.acorr_ljungbox(x, lags, model_df): Q over lags 1…L, χ²
 *                            with lag − model_df degrees of freedom (no p-value where that is 0 or less).
 *  - adfTest                 statsmodels adfuller(x, maxlag, regression, autolag="AIC" | None): Schwert's maxlag
 *                            rule, every candidate lag fitted on the common sample, then a refit at the chosen lag.
 *  - mackinnonP / mackinnonCrit  statsmodels.tsa.adfvalues (MacKinnon 1994 p-value surfaces, 2010 critical values).
 *  - kpssTest                statsmodels kpss(x, regression, nlags="auto" | k): Hobijn et al. (1998) bandwidth,
 *                            Bartlett-weighted long-run variance, p interpolated in the KPSS (1992) table.
 *  - hpFilter                statsmodels hpfilter(x, lamb): (I + λK'K)τ = y solved by a banded (pentadiagonal)
 *                            Cholesky factorisation, O(n).
 *
 * Every statistic here is unchanged when the series is multiplied by a constant (and the HP trend scales with it),
 * so each engine divides the series by its largest absolute value first: 10⁻¹² and 10¹² scales then compute exactly as
 * a series of ordinary size does, with no overflow in the squares.
 */
import { chiSquareP } from "./stats2";
import { normalCdfPrecise, normalQuantile } from "./probdist";

export type Refusal = { ok: false; reason: string };

/** z for 95% bands, scipy.stats.norm.ppf(0.975). */
export const Z975 = normalQuantile(0.975);

/** The series divided by its largest absolute value (null for an all-zero or non-finite series). */
function scaled(x: ArrayLike<number>): { v: Float64Array; s: number } | null {
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (!Number.isFinite(a)) return null;
    if (a > s) s = a;
  }
  if (!(s > 0)) return null;
  const v = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) v[i] = x[i] / s;
  return { v, s };
}

function demeaned(v: Float64Array): Float64Array {
  let m = 0;
  for (let i = 0; i < v.length; i++) m += v[i];
  m /= v.length;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - m;
  return out;
}

/** True when every value equals the first (to the last bit). */
export function isConstantSeries(x: ArrayLike<number>): boolean {
  for (let i = 1; i < x.length; i++) if (x[i] !== x[0]) return false;
  return true;
}

// --- ACF, PACF, Ljung–Box ---------------------------------------------------------------------------------------

/** statsmodels' pacf default nlags: max(min(int(10·log10 n), n // 2 − 1), 1). */
export function pacfDefaultLags(n: number): number {
  return Math.max(Math.min(Math.trunc(10 * Math.log10(n)), Math.floor(n / 2) - 1), 1);
}

/** acorr_ljungbox's default number of lags: min(10, n // 5). */
export function ljungBoxDefaultLags(n: number): number {
  return Math.min(10, Math.floor(n / 5));
}

/** Autocorrelations r_0…r_K with divisor n (acf adjusted=False), or null for a constant series. */
export function acfBiased(x: ArrayLike<number>, K: number): Float64Array | null {
  const sc = scaled(x);
  if (!sc) return null;
  const d = demeaned(sc.v);
  const n = d.length;
  const kmax = Math.min(Math.max(0, Math.floor(K)), n - 1);
  const r = new Float64Array(kmax + 1);
  let c0 = 0;
  for (let i = 0; i < n; i++) c0 += d[i] * d[i];
  if (!(c0 > 0)) return null;
  r[0] = 1;
  for (let k = 1; k <= kmax; k++) {
    let c = 0;
    for (let i = k; i < n; i++) c += d[i] * d[i - k];
    r[k] = c / c0;
  }
  return r;
}

/** Bartlett half-widths for lags 0…K: z·√((1 + 2Σ_{j=1}^{k−1} r_j²)/n), 0 at lag 0 (acf alpha, bartlett_confint). */
export function acfBands(r: Float64Array, n: number, z = Z975): Float64Array {
  const out = new Float64Array(r.length);
  let cum = 0;
  for (let k = 1; k < r.length; k++) {
    out[k] = z * Math.sqrt((1 + 2 * cum) / n);
    cum += r[k] * r[k];
  }
  return out;
}

/**
 * PACF by Yule–Walker with the adjusted autocovariances (divisor n − k), statsmodels' default "ywadjusted": for each
 * order k the last coefficient of the solution of Toeplitz(γ_0…γ_{k−1}) φ = (γ_1…γ_k). Levinson–Durbin solves the same
 * systems. Values above 1 in magnitude can occur with these autocovariances and are returned as statsmodels returns
 * them; a recursion whose innovation variance reaches zero or below (a singular system) is refused by lag.
 */
export function pacfYwAdjusted(x: ArrayLike<number>, K: number): { ok: true; pacf: Float64Array } | Refusal {
  const sc = scaled(x);
  if (!sc) return { ok: false, reason: "The series is constant, so it has no partial autocorrelations." };
  const d = demeaned(sc.v);
  const n = d.length;
  if (K < 1 || K > Math.floor(n / 2)) return { ok: false, reason: `The PACF needs 1 to ${Math.floor(n / 2)} lags (half the series).` };
  const g = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) {
    let c = 0;
    for (let i = k; i < n; i++) c += d[i] * d[i - k];
    g[k] = c / (n - k);
  }
  const pacf = new Float64Array(K + 1);
  pacf[0] = 1;
  let phi = new Float64Array(K + 1);
  let next = new Float64Array(K + 1);
  let sig = g[0];
  for (let k = 1; k <= K; k++) {
    let num = g[k];
    for (let j = 1; j < k; j++) num -= phi[j] * g[k - j];
    if (!(sig > 0) || !Number.isFinite(sig)) {
      return { ok: false, reason: `The Yule–Walker system is singular at lag ${k} for these data; ask for fewer lags.` };
    }
    const a = num / sig;
    next[k] = a;
    for (let j = 1; j < k; j++) next[j] = phi[j] - a * phi[k - j];
    sig *= 1 - a * a;
    pacf[k] = a;
    const t = phi;
    phi = next;
    next = t;
  }
  for (let k = 1; k <= K; k++) if (!Number.isFinite(pacf[k])) return { ok: false, reason: `The PACF at lag ${k} is not a finite number for these data.` };
  return { ok: true, pacf };
}

export interface LjungBoxRow {
  lag: number;
  q: number;
  /** lag − modelDf. */
  df: number;
  /** null where df ≤ 0 (statsmodels returns NaN there). */
  p: number | null;
}

/**
 * Ljung–Box Q for lags 1…`lags`, as statsmodels' acorr_ljungbox(x, lags=lags, model_df=modelDf):
 * Q_L = n(n + 2) Σ_{k=1}^{L} r_k²/(n − k) with the divisor-n autocorrelations, p from χ² with L − modelDf df.
 * For ARIMA(p, d, q) residuals pass modelDf = p + q.
 */
export function ljungBox(x: ArrayLike<number>, lags: number, modelDf = 0): { ok: true; rows: LjungBoxRow[] } | Refusal {
  const n = x.length;
  if (!Number.isInteger(lags) || lags < 1) return { ok: false, reason: "Ljung–Box needs a whole number of lags, 1 or more." };
  if (lags > n - 1) return { ok: false, reason: `Ljung–Box needs fewer lags than observations (at most ${n - 1} here).` };
  if (!Number.isInteger(modelDf) || modelDf < 0) return { ok: false, reason: "The model degrees of freedom must be a whole number, 0 or more." };
  const r = acfBiased(x, lags);
  if (!r) return { ok: false, reason: "The series is constant (or not finite), so Ljung–Box cannot be computed." };
  const rows: LjungBoxRow[] = [];
  let cum = 0;
  for (let k = 1; k <= lags; k++) {
    cum += (r[k] * r[k]) / (n - k);
    const q = n * (n + 2) * cum;
    const df = k - modelDf;
    rows.push({ lag: k, q, df, p: df > 0 ? chiSquareP(q, df) : null });
  }
  return { ok: true, rows };
}

// --- MacKinnon response surfaces ----------------------------------------------------------------------------------

export type AdfRegression = "n" | "c" | "ct";

/*
 * Coefficient tables for one I(1) series (N = 1), copied verbatim from statsmodels/tsa/adfvalues.py (BSD-3,
 * Copyright (c) 2009-2018 statsmodels Developers), which takes them from MacKinnon, J.G. (1994), "Approximate
 * asymptotic distribution functions for unit-root and cointegration tests", Journal of Business & Economic Statistics
 * 12(2): 167–176 (the p-value surfaces), and MacKinnon, J.G. (2010), "Critical values for cointegration tests", Queen's
 * University Economics Working Paper 1227 (the critical values). The raw rows are kept as printed there; the scaling
 * statsmodels applies at import (small × [1, 1, 10⁻²], large × [1, 10⁻¹, 10⁻¹, 10⁻²]) is applied below the same way.
 * The jest suite checks every entry against the values extracted from statsmodels by scripts/ts-diag-oracle.py.
 */
export const MACKINNON_RAW: Record<
  AdfRegression,
  { tauStar: number; tauMin: number; tauMax: number; smallp: number[]; largep: number[]; crit2010: number[][] }
> = {
  n: {
    tauStar: -1.04,
    tauMin: -19.04,
    tauMax: Infinity,
    smallp: [0.6344, 1.2378, 3.2496],
    largep: [0.4797, 9.3557, -0.6999, 3.3066],
    crit2010: [
      [-2.56574, -2.2358, -3.627, 0],
      [-1.941, -0.2686, -3.365, 31.223],
      [-1.61682, 0.2656, -2.714, 25.364],
    ],
  },
  c: {
    tauStar: -1.61,
    tauMin: -18.83,
    tauMax: 2.74,
    smallp: [2.1659, 1.4412, 3.8269],
    largep: [1.7339, 9.3202, -1.2745, -1.0368],
    crit2010: [
      [-3.43035, -6.5393, -16.786, -79.433],
      [-2.86154, -2.8903, -4.234, -40.04],
      [-2.56677, -1.5384, -2.809, 0],
    ],
  },
  ct: {
    tauStar: -2.89,
    tauMin: -16.18,
    tauMax: 0.7,
    smallp: [3.2512, 1.6047, 4.9588],
    largep: [2.5261, 6.1654, -3.7956, -6.0285],
    crit2010: [
      [-3.95877, -9.0531, -28.428, -134.155],
      [-3.41049, -4.3904, -9.036, -45.374],
      [-3.12705, -2.5856, -3.925, -22.38],
    ],
  },
};

const SMALL_SCALING = [1, 1, 1e-2];
const LARGE_SCALING = [1, 1e-1, 1e-1, 1e-2];

/** The scaled p-value coefficients, exactly as statsmodels holds them after import. */
export function mackinnonCoefs(reg: AdfRegression): { smallp: number[]; largep: number[] } {
  const t = MACKINNON_RAW[reg];
  return { smallp: t.smallp.map((v, i) => v * SMALL_SCALING[i]), largep: t.largep.map((v, i) => v * LARGE_SCALING[i]) };
}

/** numpy.polyval with coefficients lowest power first (Horner from the top). */
function polyLow(c: number[], x: number): number {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * x + c[i];
  return s;
}

/** MacKinnon's approximate p-value for an ADF τ (statsmodels mackinnonp, N = 1). */
export function mackinnonP(tau: number, reg: AdfRegression): number {
  const t = MACKINNON_RAW[reg];
  if (tau > t.tauMax) return 1;
  if (tau < t.tauMin) return 0;
  const c = mackinnonCoefs(reg);
  return normalCdfPrecise(polyLow(tau <= t.tauStar ? c.smallp : c.largep, tau));
}

/** MacKinnon (2010) 1%, 5%, 10% critical values at sample size nobs: β∞ + β₁/T + β₂/T² + β₃/T³. */
export function mackinnonCrit(reg: AdfRegression, nobs: number): [number, number, number] {
  const rows = MACKINNON_RAW[reg].crit2010;
  const x = 1 / nobs;
  const v = rows.map((r) => polyLow(r, x));
  return [v[0], v[1], v[2]];
}

// --- Least squares by Householder QR -------------------------------------------------------------------------------

interface Qr {
  /** Columns, overwritten: R above the diagonal, the reflectors below. */
  cols: Float64Array[];
  rdiag: Float64Array;
  /** Qᵀy. */
  qty: Float64Array;
  m: number;
  p: number;
}

/**
 * Householder QR of the columns (no pivoting, so the leading c columns span the same space as the first c of the
 * design). Returns null when a column is (numerically) a combination of the ones before it.
 */
function householder(cols: Float64Array[], y: Float64Array): Qr | null {
  const m = y.length;
  const p = cols.length;
  const rdiag = new Float64Array(p);
  const qty = Float64Array.from(y);
  for (let j = 0; j < p; j++) {
    const a = cols[j];
    let orig = 0;
    let norm = 0;
    for (let i = 0; i < m; i++) orig += a[i] * a[i];
    for (let i = j; i < m; i++) norm += a[i] * a[i];
    norm = Math.sqrt(norm);
    if (!(norm > 1e-11 * Math.sqrt(orig)) || !Number.isFinite(norm)) return null;
    const alpha = a[j] > 0 ? -norm : norm;
    // v = a[j..] − alpha e_1, stored in place; vᵀv = 2 norm (norm + |a_j|) = −2 alpha v_1, so 2/vᵀv = −1/(alpha v_1).
    a[j] -= alpha;
    const beta = -1 / (alpha * a[j]);
    for (let k = j + 1; k < p; k++) {
      const b = cols[k];
      let s = 0;
      for (let i = j; i < m; i++) s += a[i] * b[i];
      s *= beta;
      if (s !== 0) for (let i = j; i < m; i++) b[i] -= s * a[i];
    }
    let s = 0;
    for (let i = j; i < m; i++) s += a[i] * qty[i];
    s *= beta;
    for (let i = j; i < m; i++) qty[i] -= s * a[i];
    rdiag[j] = alpha;
  }
  return { cols, rdiag, qty, m, p };
}

/** R[i][j] for i < j from the overwritten columns, R[j][j] = rdiag[j]. */
function rAt(qr: Qr, i: number, j: number): number {
  return i === j ? qr.rdiag[j] : qr.cols[j][i];
}

// --- ADF ------------------------------------------------------------------------------------------------------------

export interface AdfResult {
  stat: number;
  p: number;
  usedLag: number;
  maxLag: number;
  nobs: number;
  /** 1%, 5%, 10% at nobs (MacKinnon 2010). */
  crit: [number, number, number];
  /** The minimised AIC (autolag only). */
  icBest?: number;
  autolag: boolean;
}

/**
 * The most work one ADF fit may take, rows × columns² of its QR (a pane must never freeze): the Schwert default at
 * 100,000 rows (68 lags, ≈ 4.9×10⁸) fits, a hand-entered lag of thousands does not.
 */
export const ADF_WORK_MAX = 1e9;

/** The ADF QR's work for lag L on n values: (n − 1 − L)·(ndet + 1 + L)². */
function adfWork(n: number, ndet: number, L: number): number {
  return (n - 1 - L) * (ndet + 1 + L) * (ndet + 1 + L);
}

/** The largest lag whose ADF fit stays within ADF_WORK_MAX. */
export function adfWorkLagCap(n: number, reg: AdfRegression): number {
  const ndet = reg === "n" ? 0 : reg.length;
  let L = 0;
  while (L < n && adfWork(n, ndet, L + 1) <= ADF_WORK_MAX) L++;
  return L;
}

/** Schwert's rule as statsmodels applies it: min(n // 2 − ntrend − 1, ceil(12·(n/100)^¼)). */
export function adfDefaultMaxLag(n: number, reg: AdfRegression): number {
  const ntrend = reg === "n" ? 0 : reg.length;
  const schwert = Math.ceil(12.0 * Math.pow(n / 100.0, 1 / 4.0));
  return Math.min(Math.floor(n / 2) - ntrend - 1, schwert);
}

/** The largest lag adfuller accepts: n // 2 − ntrend − 1. */
export function adfLagCap(n: number, reg: AdfRegression): number {
  return Math.floor(n / 2) - (reg === "n" ? 0 : reg.length) - 1;
}

/** The ADF design for lag L on the sample that a lag of `sampleLag` leaves: [deterministic…, level, Δ lags 1…L]. */
function adfDesign(v: Float64Array, reg: AdfRegression, L: number, sampleLag: number): { cols: Float64Array[]; y: Float64Array } {
  const n = v.length;
  const m = n - 1 - sampleLag;
  const cols: Float64Array[] = [];
  if (reg !== "n") cols.push(new Float64Array(m).fill(1));
  if (reg === "ct") {
    const t = new Float64Array(m);
    for (let r = 0; r < m; r++) t[r] = r + 1;
    cols.push(t);
  }
  const lev = new Float64Array(m);
  const y = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    const t = r + sampleLag;
    lev[r] = v[t];
    y[r] = v[t + 1] - v[t];
  }
  cols.push(lev);
  for (let l = 1; l <= L; l++) {
    const c = new Float64Array(m);
    for (let r = 0; r < m; r++) {
      const t = r + sampleLag;
      c[r] = v[t - l + 1] - v[t - l];
    }
    cols.push(c);
  }
  return { cols, y };
}

/**
 * The augmented Dickey–Fuller test, statsmodels adfuller(x, maxlag, regression, autolag="AIC" | None).
 * With autolag every lag 0…maxlag is fitted on the common sample (n − 1 − maxlag rows): one QR of the full design
 * gives every nested residual sum of squares, and AIC = −2 log L + 2k picks the lag (smallest AIC; a tie goes to the
 * shorter lag, as Python's min over (aic, lag) pairs). The chosen lag is then refitted on its own longer sample, and τ is
 * the t-ratio of the lagged level there. Without autolag the lag is maxlag.
 */
export function adfTest(
  x: ArrayLike<number>,
  opts: { regression: AdfRegression; maxLag?: number; autolag: boolean },
): ({ ok: true } & AdfResult) | Refusal {
  const reg = opts.regression;
  const n = x.length;
  if (isConstantSeries(x)) return { ok: false, reason: "The series is constant, so the ADF test has nothing to test." };
  const sc = scaled(x);
  if (!sc) return { ok: false, reason: "The series has a value that is not a finite number." };
  const cap = adfLagCap(n, reg);
  let maxLag: number;
  if (opts.maxLag === undefined) {
    maxLag = adfDefaultMaxLag(n, reg);
    if (maxLag < 0) return { ok: false, reason: `The series is too short (${n} values) for the ADF regression with these deterministic terms.` };
  } else {
    maxLag = opts.maxLag;
    if (!Number.isInteger(maxLag) || maxLag < 0) return { ok: false, reason: "The ADF lag must be a whole number, 0 or more." };
    if (maxLag > cap) {
      return {
        ok: false,
        reason: `The ADF lag can be at most ${Math.max(cap, 0)} for ${n} values with these deterministic terms (n // 2 − 1 − the number of trend terms, statsmodels' limit).`,
      };
    }
  }
  const v = sc.v;
  const ndet = reg === "n" ? 0 : reg.length;
  if (adfWork(n, ndet, maxLag) > ADF_WORK_MAX) {
    return {
      ok: false,
      reason: `An ADF lag of ${maxLag.toLocaleString("en-US")} on ${n.toLocaleString("en-US")} values is more work than the pane allows; use a lag of at most ${adfWorkLagCap(n, reg).toLocaleString("en-US")}.`,
    };
  }
  let usedLag = maxLag;
  let icBest: number | undefined;
  if (opts.autolag) {
    const { cols, y } = adfDesign(v, reg, maxLag, maxLag);
    const qr = householder(cols, y);
    if (!qr) return { ok: false, reason: "The ADF regression is singular for this series (a lag or the level is an exact combination of the other terms)." };
    const m = y.length;
    // SSR of the first c columns = Σ_{i ≥ c} (Qᵀy)_i².
    const tail = new Float64Array(qr.p + 1);
    let acc = 0;
    for (let i = m - 1; i >= qr.p; i--) acc += qr.qty[i] * qr.qty[i];
    tail[qr.p] = acc;
    for (let c = qr.p - 1; c >= 0; c--) tail[c] = tail[c + 1] + qr.qty[c] * qr.qty[c];
    let best = Infinity;
    let bestLag = 0;
    for (let L = 0; L <= maxLag; L++) {
      const k = ndet + 1 + L;
      const ssr = tail[k];
      const llf = -(m / 2) * (Math.log(2 * Math.PI) + Math.log(ssr / m) + 1);
      const aic = -2 * llf + 2 * k;
      if (aic < best) {
        best = aic;
        bestLag = L;
      }
    }
    if (!Number.isFinite(best)) return { ok: false, reason: "The ADF regressions fit the series exactly (zero residuals), so no lag can be chosen." };
    usedLag = bestLag;
    // statsmodels' icbest is the AIC of the scaled problem's regression; shift back to the data's own units.
    icBest = best + 2 * m * Math.log(sc.s);
  }
  const { cols, y } = adfDesign(v, reg, usedLag, usedLag);
  const m = y.length;
  const p = cols.length;
  if (m - p < 1) return { ok: false, reason: "The ADF regression has no residual degrees of freedom; use a shorter lag or a longer series." };
  const qr = householder(cols, y);
  if (!qr) return { ok: false, reason: "The ADF regression is singular for this series (a lag or the level is an exact combination of the other terms)." };
  let ssr = 0;
  for (let i = p; i < m; i++) ssr += qr.qty[i] * qr.qty[i];
  // β by back substitution; the level's variance factor (XᵀX)⁻¹_jj = ‖R⁻ᵀ e_j‖².
  const beta = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let s = qr.qty[i];
    for (let j = i + 1; j < p; j++) s -= rAt(qr, i, j) * beta[j];
    beta[i] = s / qr.rdiag[i];
  }
  const jl = ndet;
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = i === jl ? 1 : 0;
    for (let k = 0; k < i; k++) s -= rAt(qr, k, i) * z[k];
    z[i] = s / qr.rdiag[i];
  }
  let vf = 0;
  for (let i = 0; i < p; i++) vf += z[i] * z[i];
  const sigma2 = ssr / (m - p);
  const stat = beta[jl] / Math.sqrt(sigma2 * vf);
  if (!Number.isFinite(stat)) return { ok: false, reason: "The ADF statistic is not a finite number for this series (the regression fits it exactly)." };
  return {
    ok: true,
    stat,
    p: mackinnonP(stat, reg),
    usedLag,
    maxLag,
    nobs: m,
    crit: mackinnonCrit(reg, m),
    icBest,
    autolag: opts.autolag,
  };
}

// --- KPSS -----------------------------------------------------------------------------------------------------------

export type KpssRegression = "c" | "ct";

/** Kwiatkowski, Phillips, Schmidt & Shin (1992), Table 1: 10%, 5%, 2.5%, 1% (as in statsmodels' kpss). */
export const KPSS_CRIT: Record<KpssRegression, [number, number, number, number]> = {
  c: [0.347, 0.463, 0.574, 0.739],
  ct: [0.119, 0.146, 0.176, 0.216],
};
const KPSS_PVALS = [0.1, 0.05, 0.025, 0.01];

/** The most lags × observations the KPSS variance sum may take (a pane must never freeze). */
export const KPSS_WORK_MAX = 2e8;

export interface KpssResult {
  stat: number;
  /** numpy.interp in the table: 0.10 or 0.01 at the table's ends. */
  p: number;
  /** "above" when the statistic is below the 10% value (p > 0.10), "below" when above the 1% value (p < 0.01). */
  pBound?: "above" | "below";
  lags: number;
  auto: boolean;
  crit: [number, number, number, number];
}

function kpssResiduals(v: Float64Array, reg: KpssRegression): Float64Array {
  const n = v.length;
  const out = new Float64Array(n);
  if (reg === "c") return demeaned(v);
  // OLS on [1, t], t = 1…n, by centred sums.
  const tbar = (n + 1) / 2;
  let ybar = 0;
  for (let i = 0; i < n; i++) ybar += v[i];
  ybar /= n;
  let sty = 0;
  let stt = 0;
  for (let i = 0; i < n; i++) {
    const dt = i + 1 - tbar;
    sty += dt * (v[i] - ybar);
    stt += dt * dt;
  }
  const b = sty / stt;
  for (let i = 0; i < n; i++) out[i] = v[i] - ybar - b * (i + 1 - tbar);
  return out;
}

/** Hobijn, Franses & Ooms (1998) automatic bandwidth, exactly as statsmodels' _kpss_autolag. */
export function kpssAutoLag(resids: Float64Array): number {
  const nobs = resids.length;
  const covlags = Math.trunc(Math.pow(nobs, 2.0 / 9.0));
  let s0 = 0;
  for (let i = 0; i < nobs; i++) s0 += resids[i] * resids[i];
  s0 /= nobs;
  let s1 = 0;
  for (let i = 1; i <= covlags; i++) {
    let prod = 0;
    for (let t = i; t < nobs; t++) prod += resids[t] * resids[t - i];
    prod /= nobs / 2.0;
    s0 += prod;
    s1 += i * prod;
  }
  const sHat = s1 / s0;
  const pwr = 1.0 / 3.0;
  const gammaHat = 1.1447 * Math.pow(sHat * sHat, pwr);
  const lags = Math.trunc(gammaHat * Math.pow(nobs, pwr));
  return Number.isFinite(lags) ? lags : -1;
}

/** numpy.interp(x, xp, fp) for increasing xp. */
function interp(x: number, xp: number[], fp: number[]): number {
  if (x <= xp[0]) return fp[0];
  if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
  for (let i = 1; i < xp.length; i++) {
    if (x <= xp[i]) {
      const t = (x - xp[i - 1]) / (xp[i] - xp[i - 1]);
      return fp[i - 1] + t * (fp[i] - fp[i - 1]);
    }
  }
  return fp[fp.length - 1];
}

/** The KPSS test, statsmodels kpss(x, regression, nlags="auto" | k). */
export function kpssTest(x: ArrayLike<number>, opts: { regression: KpssRegression; lags?: number }): ({ ok: true } & KpssResult) | Refusal {
  const n = x.length;
  if (isConstantSeries(x)) return { ok: false, reason: "The series is constant, so the KPSS test has nothing to test." };
  const sc = scaled(x);
  if (!sc) return { ok: false, reason: "The series has a value that is not a finite number." };
  const e = kpssResiduals(sc.v, opts.regression);
  let lags: number;
  const auto = opts.lags === undefined;
  if (auto) {
    lags = kpssAutoLag(e);
    if (lags < 0) return { ok: false, reason: "The automatic KPSS bandwidth is not a finite number for this series; give a fixed number of lags." };
    lags = Math.min(lags, n - 1);
  } else {
    lags = opts.lags as number;
    if (!Number.isInteger(lags) || lags < 0) return { ok: false, reason: "The KPSS lags must be a whole number, 0 or more." };
    if (lags >= n) return { ok: false, reason: `The KPSS lags (${lags}) must be fewer than the observations (${n}).` };
  }
  if (lags * n > KPSS_WORK_MAX) {
    return {
      ok: false,
      reason: `The KPSS long-run variance would need ${lags.toLocaleString("en-US")} lags over ${n.toLocaleString("en-US")} values, more work than the pane allows; give a fixed number of lags (at most ${Math.floor(KPSS_WORK_MAX / n).toLocaleString("en-US")}).`,
    };
  }
  let cum = 0;
  let eta = 0;
  for (let i = 0; i < n; i++) {
    cum += e[i];
    eta += cum * cum;
  }
  eta /= n * n;
  let s = 0;
  for (let i = 0; i < n; i++) s += e[i] * e[i];
  for (let i = 1; i <= lags; i++) {
    let prod = 0;
    for (let t = i; t < n; t++) prod += e[t] * e[t - i];
    s += 2 * prod * (1.0 - i / (lags + 1.0));
  }
  s /= n;
  const stat = eta / s;
  if (!Number.isFinite(stat) || !(s > 0)) {
    return { ok: false, reason: "The KPSS long-run variance is zero or negative for this series with these lags; try another number of lags." };
  }
  const crit = KPSS_CRIT[opts.regression];
  const p = interp(stat, crit, KPSS_PVALS);
  const pBound = stat < crit[0] ? "above" : stat > crit[3] ? "below" : undefined;
  return { ok: true, stat, p, pBound, lags, auto, crit };
}

// --- Hodrick–Prescott -----------------------------------------------------------------------------------------------

/**
 * The HP trend: τ solving (I + λKᵀK)τ = y, K the (n − 2) × n second-difference matrix (rows 1, −2, 1), as statsmodels'
 * hpfilter (which solves the same sparse system by LU). The matrix is symmetric, positive definite and pentadiagonal,
 * so a banded Cholesky factorisation LDLᵀ solves it in O(n) with no pivoting.
 */
export function hpFilter(y: ArrayLike<number>, lambda: number): { ok: true; trend: Float64Array; cycle: Float64Array } | Refusal {
  const n = y.length;
  if (n < 3) return { ok: false, reason: "The HP filter needs at least 3 values." };
  if (!Number.isFinite(lambda) || lambda < 0) return { ok: false, reason: "λ must be a finite number, 0 or more." };
  const sc = scaled(y);
  const trend = new Float64Array(n);
  const cycle = new Float64Array(n);
  if (!sc) {
    for (let i = 0; i < n; i++) if (!Number.isFinite(y[i])) return { ok: false, reason: "The series has a value that is not a finite number." };
    return { ok: true, trend, cycle };
  }
  // Bands of A = I + λKᵀK: d (diagonal), e (first off-diagonal), f (second).
  const d = new Float64Array(n).fill(1);
  const e = new Float64Array(n);
  const f = new Float64Array(n);
  const k = [1, -2, 1];
  for (let r = 0; r < n - 2; r++) {
    for (let a = 0; a < 3; a++) {
      d[r + a] += lambda * k[a] * k[a];
      for (let b = a + 1; b < 3; b++) {
        if (b - a === 1) e[r + a] += lambda * k[a] * k[b];
        else f[r + a] += lambda * k[a] * k[b];
      }
    }
  }
  // LDLᵀ with L unit lower-banded: l1[i] = L[i+1][i], l2[i] = L[i+2][i].
  const D = new Float64Array(n);
  const l1 = new Float64Array(n);
  const l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let di = d[i];
    if (i >= 1) di -= l1[i - 1] * l1[i - 1] * D[i - 1];
    if (i >= 2) di -= l2[i - 2] * l2[i - 2] * D[i - 2];
    if (!(di > 0)) return { ok: false, reason: "The HP system lost positive definiteness for this λ (too large to solve accurately); use a smaller λ." };
    D[i] = di;
    if (i + 1 < n) {
      let v = e[i];
      if (i >= 1) v -= l2[i - 1] * l1[i - 1] * D[i - 1];
      l1[i] = v / di;
    }
    if (i + 2 < n) l2[i] = f[i] / di;
  }
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = sc.v[i];
    if (i >= 1) v -= l1[i - 1] * w[i - 1];
    if (i >= 2) v -= l2[i - 2] * w[i - 2];
    w[i] = v;
  }
  for (let i = 0; i < n; i++) w[i] /= D[i];
  for (let i = n - 1; i >= 0; i--) {
    let v = w[i];
    if (i + 1 < n) v -= l1[i] * trend[i + 1];
    if (i + 2 < n) v -= l2[i] * trend[i + 2];
    trend[i] = v;
  }
  for (let i = 0; i < n; i++) {
    trend[i] *= sc.s;
    cycle[i] = y[i] - trend[i];
    if (!Number.isFinite(trend[i])) return { ok: false, reason: "The HP trend is not a finite number for this series and λ." };
  }
  return { ok: true, trend, cycle };
}
