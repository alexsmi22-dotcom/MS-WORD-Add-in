/**
 * Portfolio and risk engines (release F1, gap item #4). Pure functions on per-period simple returns written as
 * decimals (0.012 = 1.2%); the calculators in portcorpCalcs.ts read and print them.
 *
 *   performance   arithmetic and geometric means, volatility (sample, n − 1), Sharpe, Sortino (downside deviation
 *                 √(mean(min(r − MAR, 0)²)) over ALL n periods), Treynor (with a beta), maximum drawdown on a wealth
 *                 index that starts at 1 before the first return, Calmar; annualised by ppy (means) and √ppy (σ).
 *   CAPM          the excess-return regression r − r_f = α + β (r_m − r_f) + ε by the econometrics OLS engine
 *                 (olsInference.ts, classical / HC1 / Newey–West standard errors), information ratio, Treynor.
 *   VaR / CVaR    historical (numpy's default linear percentile, PERCENTILE.INC), parametric normal, parametric
 *                 Student t (scaled to the sample variance), and Monte Carlo normal on PCG32 (Box–Muller, seed printed).
 *   Markowitz     long-only frontier, minimum-variance and tangency portfolios by the active-set QP (qpActiveSet.ts),
 *                 tangency through PyPortfolioOpt's change of variables (min yᵀΣy, (μ − r_f)ᵀy = 1, y ≥ 0).
 */
import { fitOls, type SeType, hacDefaultLag } from "./olsInference";
import { normalQuantile, tDist } from "./probdist";
import { Pcg32, PCG_STREAM, PCG_MAX_SEED } from "./prng";
import { solveQpNonneg } from "./qpActiveSet";

export type Err = { error: string };

export const sum = (xs: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
};
export const meanOf = (xs: ArrayLike<number>): number => sum(xs) / xs.length;
/** Sample standard deviation (n − 1), by a two-pass sum. */
export function sdOf(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = meanOf(xs);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) * (xs[i] - m);
  return Math.sqrt(s / (n - 1));
}

/** numpy.percentile's default (method="linear", Excel PERCENTILE.INC) on an ascending array; p in [0, 1]. */
export function percentileLinear(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// ------------------------------------------------------------------------------------------------------------------
// Drawdown and performance
// ------------------------------------------------------------------------------------------------------------------

export interface Drawdown {
  /** Wealth index W₀ = 1, Wₜ = Wₜ₋₁(1 + rₜ); length n + 1. */
  wealth: number[];
  /** Wₜ / max_{s ≤ t} W_s − 1 (≤ 0); length n + 1. */
  dd: number[];
  /** The deepest drawdown (≤ 0) and where: the peak before it, the trough, and the first period back at the peak. */
  max: number;
  peak: number;
  trough: number;
  recovery: number | null;
  /** The longest run of periods below a previous peak (periods). */
  longest: number;
}

export function drawdown(r: number[]): Drawdown {
  const wealth = [1];
  for (const x of r) wealth.push(wealth[wealth.length - 1] * (1 + x));
  const dd: number[] = [];
  let peakVal = wealth[0];
  let peakAt = 0;
  let max = 0;
  let peak = 0;
  let trough = 0;
  let runStart = -1;
  let longest = 0;
  for (let t = 0; t < wealth.length; t++) {
    if (wealth[t] >= peakVal) {
      peakVal = wealth[t];
      peakAt = t;
      if (runStart >= 0) longest = Math.max(longest, t - runStart);
      runStart = -1;
    } else if (runStart < 0) runStart = peakAt;
    const d = wealth[t] / peakVal - 1;
    dd.push(d);
    if (d < max) {
      max = d;
      peak = peakAt;
      trough = t;
    }
  }
  if (runStart >= 0) longest = Math.max(longest, wealth.length - 1 - runStart);
  let recovery: number | null = null;
  if (max < 0) {
    for (let t = trough + 1; t < wealth.length; t++) {
      if (wealth[t] >= wealth[peak]) {
        recovery = t;
        break;
      }
    }
  }
  return { wealth, dd, max, peak, trough, recovery, longest };
}

export interface Performance {
  n: number;
  meanPer: number;
  meanAnnual: number;
  geoAnnual: number;
  sdPer: number;
  volAnnual: number;
  /** null: undefined (zero volatility, or no period below the MAR). */
  sharpe: number | null;
  downsideDev: number;
  sortino: number | null;
  treynor: number | null;
  calmar: number | null;
  dd: Drawdown;
  totalReturn: number;
}

export function performance(r: number[], ppy: number, rfPer: number, mar: number, beta: number | null): Performance | Err {
  const n = r.length;
  if (n < 2) return { error: "Returns: at least 2 periods are needed for a standard deviation." };
  for (const x of r) if (!(x > -1)) return { error: "Returns: a return of −100% or below wipes the portfolio out; the wealth index cannot continue past it." };
  const meanPer = meanOf(r);
  const sdPer = sdOf(r);
  const ex = r.map((x) => x - rfPer);
  const exMean = meanOf(ex);
  const sdEx = sdOf(ex);
  const scale = Math.max(...r.map(Math.abs), 1e-300);
  const sharpe = sdEx > 1e-12 * scale ? (exMean / sdEx) * Math.sqrt(ppy) : null;
  let dsq = 0;
  for (const x of r) {
    const d = Math.min(x - mar, 0);
    dsq += d * d;
  }
  const downsideDev = Math.sqrt(dsq / n);
  const sortino = downsideDev > 0 ? ((meanOf(r) - mar) * ppy) / (downsideDev * Math.sqrt(ppy)) : null;
  const dd = drawdown(r);
  const total = dd.wealth[n] - 1;
  const geoAnnual = Math.pow(dd.wealth[n], ppy / n) - 1;
  const treynor = beta !== null && beta !== 0 ? (exMean * ppy) / beta : null;
  const calmar = dd.max < 0 ? geoAnnual / -dd.max : null;
  return {
    n,
    meanPer,
    meanAnnual: meanPer * ppy,
    geoAnnual,
    sdPer,
    volAnnual: sdPer * Math.sqrt(ppy),
    sharpe,
    downsideDev,
    sortino,
    treynor,
    calmar,
    dd,
    totalReturn: total,
  };
}

// ------------------------------------------------------------------------------------------------------------------
// CAPM regression
// ------------------------------------------------------------------------------------------------------------------

export interface CapmResult {
  n: number;
  alpha: { coef: number; se: number; t: number; p: number; lo: number; hi: number };
  beta: { coef: number; se: number; t: number; p: number; lo: number; hi: number };
  df: number;
  r2: number;
  seLabel: string;
  hacLag?: number;
  residSd: number;
  /** Annualised variances: total, systematic β²σ²_m, idiosyncratic σ²_ε (sample, n − 1 for the total). */
  varTotal: number;
  varSys: number;
  varIdio: number;
  treynor: number;
  infoRatio: number | null;
  trackingError: number;
  sharpeAsset: number | null;
  sharpeMarket: number | null;
  meanExAsset: number;
  meanExMarket: number;
  exAsset: number[];
  exMarket: number[];
}

export function capmRegression(ra: number[], rm: number[], rf: number[], ppy: number, se: SeType): CapmResult | Err {
  const n = ra.length;
  if (n < 3) return { error: "CAPM regression: at least 3 periods are needed (2 coefficients and a residual variance)." };
  const ya = ra.map((x, i) => x - rf[i]);
  const xm = rm.map((x, i) => x - rf[i]);
  const sdm = sdOf(xm);
  if (!(sdm > 1e-12 * Math.max(...xm.map(Math.abs), 1e-300))) return { error: "Market returns: the market's excess return does not vary, so beta is not defined." };
  const hacLag = se === "hac" ? hacDefaultLag(n) : undefined;
  const fit = fitOls({ y: ya, depName: "asset excess return", X: [xm], names: ["market excess return"], constant: true, se, hacLag });
  if (!fit.ok) return { error: `CAPM regression: ${fit.reason}` };
  const m = fit.model;
  const term = (k: number) => {
    const t = m.terms[k];
    return { coef: t.coef, se: t.se, t: t.stat, p: t.p, lo: t.ciLo, hi: t.ciHi };
  };
  const beta = term(0);
  const alpha = term(1);
  const residSd = Math.sqrt(fit.sse / (n - 2));
  const active = ra.map((x, i) => x - rm[i]);
  const te = sdOf(active);
  const teScale = Math.max(...active.map(Math.abs), 1e-300);
  const meanExAsset = meanOf(ya);
  const meanExMarket = meanOf(xm);
  const sdA = sdOf(ya);
  return {
    n,
    alpha,
    beta,
    df: m.df ?? n - 2,
    r2: fit.r2,
    seLabel: m.seLabel,
    hacLag,
    residSd,
    varTotal: sdA * sdA * ppy,
    varSys: beta.coef * beta.coef * sdm * sdm * ppy,
    varIdio: residSd * residSd * ppy,
    treynor: beta.coef !== 0 ? (meanExAsset * ppy) / beta.coef : NaN,
    infoRatio: te > 1e-12 * teScale ? (meanOf(active) * ppy) / (te * Math.sqrt(ppy)) : null,
    trackingError: te * Math.sqrt(ppy),
    sharpeAsset: sdA > 0 ? (meanExAsset / sdA) * Math.sqrt(ppy) : null,
    sharpeMarket: (meanExMarket / sdm) * Math.sqrt(ppy),
    meanExAsset,
    meanExMarket,
    exAsset: ya,
    exMarket: xm,
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Value at risk
// ------------------------------------------------------------------------------------------------------------------

export interface VarLine {
  method: "historical" | "normal" | "t" | "mc";
  /** Loss as a positive fraction of the portfolio's value (negative: the quantile is a gain). */
  var: number;
  cvar: number;
}

export const MC_MAX_SIMS = 200000;
export const MC_MIN_SIMS = 1000;

/** Historical VaR and CVaR on one sample: VaR = −P_α (linear percentile), CVaR = −mean of returns ≤ P_α. */
export function historicalVar(r: ArrayLike<number>, alpha: number): { var: number; cvar: number; q: number } {
  const s = Float64Array.from(r).sort();
  const q = percentileLinear(s, alpha);
  let tot = 0;
  let k = 0;
  for (let i = 0; i < s.length && s[i] <= q; i++) {
    tot += s[i];
    k++;
  }
  return { var: -q, cvar: -(tot / k), q };
}

const PHI = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

export function normalVar(mu: number, sd: number, alpha: number): { var: number; cvar: number } {
  const z = normalQuantile(alpha);
  return { var: -(mu + sd * z), cvar: -(mu - (sd * PHI(z)) / alpha) };
}

/** Student t with ν degrees of freedom scaled so its variance equals sd² (scale s = sd·√((ν − 2)/ν)). */
export function studentTVar(mu: number, sd: number, alpha: number, nu: number): { var: number; cvar: number } {
  const d = tDist({ value: nu, text: String(nu) });
  const t = d.quantile(alpha);
  const s = sd * Math.sqrt((nu - 2) / nu);
  const es = (d.pdf!(t) / alpha) * ((nu + t * t) / (nu - 1));
  return { var: -(mu + s * t), cvar: -(mu - s * es) };
}

/** Monte Carlo normal draws μ + σz, z = √(−2 ln u₁) cos(2πu₂), uᵢ = (r + 0.5)/2³² from PCG32 (stream 54). */
export function monteCarloNormal(mu: number, sd: number, sims: number, seed: number): Float64Array {
  const rng = new Pcg32(seed, PCG_STREAM);
  const out = new Float64Array(sims);
  const TWO32 = 4294967296;
  // Bound once: jest's environment makes each Math.x lookup slow (prng.ts measured 20×); the browser is unaffected.
  const sqrt = Math.sqrt;
  const log = Math.log;
  const cos = Math.cos;
  const TWO_PI = 2 * Math.PI;
  for (let i = 0; i < sims; i++) {
    const u1 = (rng.nextU32() + 0.5) / TWO32;
    const u2 = (rng.nextU32() + 0.5) / TWO32;
    out[i] = mu + sd * sqrt(-2 * log(u1)) * cos(TWO_PI * u2);
  }
  return out;
}

export interface VarInput {
  r: number[];
  conf: number;
  horizon: number;
  nu: number;
  sims: number;
  seed: number;
}
export interface VarResult {
  lines: VarLine[];
  mu: number;
  sd: number;
  alpha: number;
  histQ: number;
}

export function valueAtRisk(v: VarInput): VarResult | Err {
  const n = v.r.length;
  if (n < 2) return { error: "Returns: at least 2 periods are needed." };
  if (!(v.conf > 50 && v.conf < 100)) return { error: "Confidence level (%) must be above 50 and below 100." };
  if (!(Number.isInteger(v.horizon) && v.horizon >= 1 && v.horizon <= 1000)) return { error: "Horizon (periods) must be a whole number from 1 to 1,000." };
  if (!(v.nu > 2 && v.nu <= 1000)) return { error: "Student t degrees of freedom ν must be above 2 (the variance is infinite at ν ≤ 2) and at most 1,000." };
  if (!(Number.isInteger(v.sims) && v.sims >= MC_MIN_SIMS && v.sims <= MC_MAX_SIMS)) return { error: `Monte Carlo draws must be a whole number from ${MC_MIN_SIMS.toLocaleString("en-US")} to ${MC_MAX_SIMS.toLocaleString("en-US")}.` };
  if (!(Number.isSafeInteger(v.seed) && v.seed >= 0 && v.seed <= PCG_MAX_SEED)) return { error: "Seed must be a whole number from 0 to 9,007,199,254,740,991." };
  const alpha = 1 - v.conf / 100;
  const mu = meanOf(v.r);
  const sd = sdOf(v.r);
  const h = v.horizon;
  const sq = Math.sqrt(h);
  const hist = historicalVar(v.r, alpha);
  const nrm = normalVar(mu * h, sd * sq, alpha);
  const st = studentTVar(mu * h, sd * sq, alpha, v.nu);
  const mcDraws = monteCarloNormal(mu * h, sd * sq, v.sims, v.seed);
  const mc = historicalVar(mcDraws, alpha);
  return {
    lines: [
      { method: "historical", var: hist.var * sq, cvar: hist.cvar * sq },
      { method: "normal", var: nrm.var, cvar: nrm.cvar },
      { method: "t", var: st.var, cvar: st.cvar },
      { method: "mc", var: mc.var, cvar: mc.cvar },
    ],
    mu,
    sd,
    alpha,
    histQ: hist.q,
  };
}

// ------------------------------------------------------------------------------------------------------------------
// Markowitz
// ------------------------------------------------------------------------------------------------------------------

/** Sample covariance (n − 1) of the columns. */
export function covariance(cols: number[][]): number[][] {
  const k = cols.length;
  const n = cols[0].length;
  const m = cols.map(meanOf);
  const S = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (cols[a][i] - m[a]) * (cols[b][i] - m[b]);
      S[a][b] = S[b][a] = s / (n - 1);
    }
  }
  return S;
}

/**
 * Cholesky with a relative pivot test: null when Σ is singular to working precision (an asset that is a constant, a
 * duplicate, or a mix of the others), with the index of the first dependent asset.
 */
export function choleskyCheck(S: number[][]): { ok: true } | { ok: false; at: number } {
  const k = S.length;
  const L = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let j = 0; j < k; j++) {
    let d = S[j][j];
    for (let p = 0; p < j; p++) d -= L[j][p] * L[j][p];
    if (!(d > 1e-10 * S[j][j]) || !(S[j][j] > 0)) return { ok: false, at: j };
    L[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < k; i++) {
      let s = S[i][j];
      for (let p = 0; p < j; p++) s -= L[i][p] * L[j][p];
      L[i][j] = s / L[j][j];
    }
  }
  return { ok: true };
}

export interface PortPoint {
  w: number[];
  ret: number;
  vol: number;
}
export interface Frontier {
  mu: number[];
  S: number[][];
  minVol: PortPoint;
  tangency: PortPoint & { sharpe: number };
  curve: PortPoint[];
  maxRet: number;
}

const quad = (S: number[][], w: number[]): number => {
  let s = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) s += w[i] * S[i][j] * w[j];
  return s;
};
const dot = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + v * b[i], 0);
const point = (w: number[], mu: number[], S: number[][]): PortPoint => ({ w, ret: dot(w, mu), vol: Math.sqrt(Math.max(0, quad(S, w))) });

/** The long-only minimum-variance portfolio at a target annual return (between the lowest and highest asset mean). */
export function efficientReturn(mu: number[], S: number[][], target: number, from?: PortPoint): PortPoint | Err {
  const k = mu.length;
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < k; i++) {
    if (mu[i] > mu[hi]) hi = i;
    if (mu[i] < mu[lo]) lo = i;
  }
  if (target > mu[hi] + 1e-15 || target < mu[lo] - 1e-15) return { error: "The target return is outside the assets' range of mean returns (long-only)." };
  let x0 = new Array<number>(k).fill(0);
  if (from && from.ret <= target && mu[hi] > from.ret) {
    // Warm start along the frontier: the previous optimum mixed with the highest-mean asset to hit the new target;
    // its support is close to the new optimum's, so the active-set method needs few steps.
    const a = Math.min(1, Math.max(0, (target - from.ret) / (mu[hi] - from.ret)));
    x0 = from.w.map((w, i) => (1 - a) * w + (i === hi ? a : 0));
  } else if (mu[hi] - mu[lo] <= 1e-15 * Math.max(1, Math.abs(mu[hi]))) x0[hi] = 1;
  else {
    const a = Math.min(1, Math.max(0, (target - mu[lo]) / (mu[hi] - mu[lo])));
    x0[hi] = a;
    x0[lo] = 1 - a;
  }
  const r = solveQpNonneg({ G: S.map((row) => row.map((v) => 2 * v)), c: new Array(k).fill(0), A: [new Array(k).fill(1), mu], b: [1, target], x0 });
  if (!r.ok) return { error: r.reason };
  return point(r.x, mu, S);
}

export const FRONTIER_POINTS = 41;

export function markowitz(cols: number[][], ppy: number, rfAnnual: number): Frontier | Err {
  const k = cols.length;
  const mu = cols.map((c) => meanOf(c) * ppy);
  const S = covariance(cols).map((row) => row.map((v) => v * ppy));
  const ch = choleskyCheck(S);
  if (!ch.ok) return { error: `The covariance matrix is singular: asset ${ch.at + 1} is constant or a combination of the assets before it (a duplicate column, or weights that are not unique). Remove it.` };
  // Minimum variance: min wᵀΣw, Σw = 1, w ≥ 0, from the lowest-variance single asset.
  let best = 0;
  for (let i = 1; i < k; i++) if (S[i][i] < S[best][best]) best = i;
  const x0 = new Array<number>(k).fill(0);
  x0[best] = 1;
  const mv = solveQpNonneg({ G: S.map((row) => row.map((v) => 2 * v)), c: new Array(k).fill(0), A: [new Array(k).fill(1)], b: [1], x0 });
  if (!mv.ok) return { error: mv.reason };
  const minVol = point(mv.x, mu, S);
  // Tangency (maximum Sharpe, long-only): min yᵀΣy, (μ − r_f)ᵀy = 1, y ≥ 0; w = y/Σy.
  const ex = mu.map((m) => m - rfAnnual);
  let kBest = -1;
  for (let i = 0; i < k; i++) if (ex[i] > 0 && (kBest < 0 || ex[i] / Math.sqrt(S[i][i]) > ex[kBest] / Math.sqrt(S[kBest][kBest]))) kBest = i;
  if (kBest < 0) return { error: "No asset's mean return is above the risk-free rate, so no long-only portfolio has a positive Sharpe ratio (no tangency portfolio)." };
  const y0 = new Array<number>(k).fill(0);
  y0[kBest] = 1 / ex[kBest];
  const tg = solveQpNonneg({ G: S.map((row) => row.map((v) => 2 * v)), c: new Array(k).fill(0), A: [ex], b: [1], x0: y0 });
  if (!tg.ok) return { error: tg.reason };
  const ys = sum(tg.x);
  const tw = tg.x.map((v) => v / ys);
  const tp = point(tw, mu, S);
  const maxRet = Math.max(...mu);
  const curve: PortPoint[] = [];
  for (let i = 0; i < FRONTIER_POINTS; i++) {
    const t = minVol.ret + ((maxRet - minVol.ret) * i) / (FRONTIER_POINTS - 1);
    const e = i === 0 ? minVol : efficientReturn(mu, S, t, curve[i - 1]);
    if ("error" in e) return e;
    curve.push(e);
  }
  return { mu, S, minVol, tangency: { ...tp, sharpe: (tp.ret - rfAnnual) / tp.vol }, curve, maxRet };
}
