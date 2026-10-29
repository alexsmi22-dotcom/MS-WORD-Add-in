/**
 * Meta-analysis (v2.206.0): inverse-variance fixed effect, Mantel–Haenszel for 2×2 counts, random effects by
 * DerSimonian–Laird or REML, heterogeneity (Q, I² with its interval, τ²), the prediction interval, and Egger's
 * regression test. Pure functions; the pane glue is clinicalStatCalcs.ts.
 *
 * Conventions (printed with the result):
 *  - Ratio measures (OR, RR, or a ratio entered with its CI) are pooled on the log scale and reported back-transformed.
 *  - From counts: a study with a zero cell gets 0.5 in every cell for its inverse-variance log OR / log RR
 *    (Haldane–Anscombe); a study with no events in either arm (or events in every subject of both) carries no
 *    information on a ratio scale and is left out, by name. Mantel–Haenszel uses the uncorrected counts.
 *  - MH OR with the Robins–Breslow–Greenland (1986) variance; MH RR and MH RD with the Greenland–Robins (1985)
 *    variances (the Cochrane Handbook formulas).
 *  - τ²: DerSimonian–Laird (1986) moment estimator, or REML by fixed-point iteration of its estimating equation (Viechtbauer 2005), both truncated at 0.
 *  - I² = (Q − df)/Q, truncated at 0; its interval by the test-based method of Higgins & Thompson (2002, Stat Med
 *    21:1539) on ln H.
 *  - The prediction interval (Higgins, Thompson & Spiegelhalter 2009): μ̂ ± t(k − 2)·√(τ² + SE(μ̂)²), k ≥ 3.
 *  - Egger, Davey Smith, Schneider & Minder (1997, BMJ 315:629): regress yᵢ/SEᵢ on 1/SEᵢ; the intercept's t test on
 *    k − 2 df. Run only with at least 10 studies (Sterne et al. 2011, BMJ 343:d4002).
 */
import { Z975, tQuantile } from "./clinicalCore";
import { chiSquareP } from "./stats2";
import { tTestP } from "./stats";
import { normalCdfPrecise } from "./probdist";

export interface Study {
  name: string;
  /** Effect on the analysis scale (log for ratios). */
  y: number;
  /** Its variance. */
  v: number;
}

export interface CountStudy {
  name: string;
  /** Events and totals: treated (1) and control (0). */
  e1: number;
  n1: number;
  e0: number;
  n0: number;
}

export type CountMeasure = "or" | "rr" | "rd";

/** The inverse-variance effect of one counts study, or a reason it is left out. */
export function countEffect(s: CountStudy, m: CountMeasure): { y: number; v: number; corrected: boolean } | { skip: string } {
  const a = s.e1;
  const b = s.n1 - s.e1;
  const c = s.e0;
  const d = s.n0 - s.e0;
  if (m === "rd") {
    const p1 = a / s.n1;
    const p0 = c / s.n0;
    const v = (p1 * (1 - p1)) / s.n1 + (p0 * (1 - p0)) / s.n0;
    if (!(v > 0)) return { skip: `${s.name}: both arms are all-or-none, so its risk difference has zero variance and no inverse-variance weight` };
    return { y: p1 - p0, v, corrected: false };
  }
  if (a + c === 0) return { skip: `${s.name}: no events in either arm` };
  if (b + d === 0) return { skip: `${s.name}: every subject in both arms had the event` };
  const corrected = a === 0 || b === 0 || c === 0 || d === 0;
  const k = corrected ? 0.5 : 0;
  const [A, B, C, D] = [a + k, b + k, c + k, d + k];
  if (m === "or") return { y: Math.log((A * D) / (B * C)), v: 1 / A + 1 / B + 1 / C + 1 / D, corrected };
  return { y: Math.log(A / (A + B) / (C / (C + D))), v: 1 / A - 1 / (A + B) + 1 / C - 1 / (C + D), corrected };
}

export interface Pooled {
  est: number;
  se: number;
  lo: number;
  hi: number;
  z: number;
  p: number;
}

function pooled(est: number, se: number): Pooled {
  const z = est / se;
  return { est, se, lo: est - Z975 * se, hi: est + Z975 * se, z, p: 2 * normalCdfPrecise(-Math.abs(z)) };
}

/** Mantel–Haenszel pooled OR / RR (log scale) or RD, over the studies that carry information. */
export function mantelHaenszel(studies: CountStudy[], m: CountMeasure): Pooled | { error: string } {
  if (m === "or") {
    let R = 0, S = 0, PR = 0, PSQR = 0, QS = 0;
    for (const s of studies) {
      const a = s.e1, b = s.n1 - s.e1, c = s.e0, d = s.n0 - s.e0, n = s.n1 + s.n0;
      const r = (a * d) / n, sv = (b * c) / n, P = (a + d) / n, Q = (b + c) / n;
      R += r; S += sv; PR += P * r; PSQR += P * sv + Q * r; QS += Q * sv;
    }
    if (!(R > 0) || !(S > 0)) return { error: "The Mantel–Haenszel odds ratio is 0 or infinite: every study has a zero in the same off-diagonal position." };
    const v = PR / (2 * R * R) + PSQR / (2 * R * S) + QS / (2 * S * S);
    return pooled(Math.log(R / S), Math.sqrt(v));
  }
  if (m === "rr") {
    let R = 0, S = 0, P = 0;
    for (const s of studies) {
      const a = s.e1, c = s.e0, n = s.n1 + s.n0;
      R += (a * s.n0) / n;
      S += (c * s.n1) / n;
      P += (s.n1 * s.n0 * (a + c) - a * c * n) / (n * n);
    }
    if (!(R > 0) || !(S > 0)) return { error: "The Mantel–Haenszel risk ratio is 0 or infinite: one arm has no events in any study." };
    return pooled(Math.log(R / S), Math.sqrt(P / (R * S)));
  }
  let W = 0, num = 0, vNum = 0;
  for (const s of studies) {
    const a = s.e1, b = s.n1 - s.e1, c = s.e0, d = s.n0 - s.e0, n = s.n1 + s.n0;
    const w = (s.n1 * s.n0) / n;
    W += w;
    num += w * (a / s.n1 - c / s.n0);
    vNum += (a * b * s.n0 ** 3 + c * d * s.n1 ** 3) / (s.n1 * s.n0 * n * n);
  }
  return pooled(num / W, Math.sqrt(vNum / (W * W)));
}

export interface MetaFit {
  k: number;
  fixed: Pooled;
  random: Pooled;
  tau2: number;
  tauMethod: "dl" | "reml";
  Q: number;
  df: number;
  pQ: number;
  i2: number;
  i2Lo: number | null;
  i2Hi: number | null;
  /** Prediction interval for a new study's true effect (k ≥ 3). */
  pi: { lo: number; hi: number } | null;
  /** Relative weights (percent) under fixed and random effects. */
  wFixed: number[];
  wRandom: number[];
  remlIterations?: number;
}

export function tauDL(y: number[], v: number[]): number {
  const w = v.map((x) => 1 / x);
  const sw = w.reduce((s, x) => s + x, 0);
  const mu = w.reduce((s, x, i) => s + x * y[i], 0) / sw;
  const Q = w.reduce((s, x, i) => s + x * (y[i] - mu) ** 2, 0);
  const c = sw - w.reduce((s, x) => s + x * x, 0) / sw;
  return Math.max(0, (Q - (y.length - 1)) / c);
}

/** REML τ² by fixed-point iteration of the restricted-likelihood equation from the DL start, truncated at 0. */
export function tauREML(y: number[], v: number[]): { tau2: number; iterations: number } {
  let t = tauDL(y, v);
  for (let it = 1; it <= 2000; it++) {
    const w = v.map((x) => 1 / (x + t));
    const sw = w.reduce((s, x) => s + x, 0);
    const mu = w.reduce((s, x, i) => s + x * y[i], 0) / sw;
    const sw2 = w.reduce((s, x) => s + x * x, 0);
    // The REML estimating equation as a fixed point (Viechtbauer 2005, J Educ Behav Stat 30:261).
    const num = w.reduce((s, x, i) => s + x * x * ((y[i] - mu) ** 2 - v[i]), 0);
    const tNew = Math.max(0, num / sw2 + 1 / sw);
    if (Math.abs(tNew - t) < 1e-12 * Math.max(1, t)) return { tau2: tNew, iterations: it };
    t = tNew;
  }
  return { tau2: t, iterations: 2000 };
}

/** Fixed and random-effects meta-analysis of effects y with variances v. `fixedOverride` replaces the IV fixed
 *  estimate (Mantel–Haenszel). */
export function metaAnalyze(y: number[], v: number[], tauMethod: "dl" | "reml", fixedOverride?: Pooled): MetaFit | { error: string } {
  const k = y.length;
  if (k < 2) return { error: `A meta-analysis needs at least two studies (there ${k === 1 ? "is one" : "are none"}).` };
  const w = v.map((x) => 1 / x);
  const sw = w.reduce((s, x) => s + x, 0);
  const muF = w.reduce((s, x, i) => s + x * y[i], 0) / sw;
  const ivFixed = pooled(muF, Math.sqrt(1 / sw));
  const Q = w.reduce((s, x, i) => s + x * (y[i] - muF) ** 2, 0);
  const df = k - 1;
  let tau2: number;
  let remlIterations: number | undefined;
  if (tauMethod === "reml") {
    const r = tauREML(y, v);
    tau2 = r.tau2;
    remlIterations = r.iterations;
  } else tau2 = tauDL(y, v);
  const wr = v.map((x) => 1 / (x + tau2));
  const swr = wr.reduce((s, x) => s + x, 0);
  const muR = wr.reduce((s, x, i) => s + x * y[i], 0) / swr;
  const random = pooled(muR, Math.sqrt(1 / swr));
  const i2 = Q > 0 ? Math.max(0, (Q - df) / Q) : 0;
  // Higgins & Thompson (2002) interval for H, then I² = (H² − 1)/H².
  let i2Lo: number | null = null;
  let i2Hi: number | null = null;
  let seLnH: number | null = null;
  if (Q > k) seLnH = (0.5 * (Math.log(Q) - Math.log(k - 1))) / (Math.sqrt(2 * Q) - Math.sqrt(2 * k - 3));
  else if (k > 2) seLnH = Math.sqrt((1 / (2 * (k - 2))) * (1 - 1 / (3 * (k - 2) ** 2)));
  if (seLnH !== null) {
    const H = Math.sqrt(Math.max(1, Q / df));
    const hLo = Math.max(1, Math.exp(Math.log(H) - Z975 * seLnH));
    const hHi = Math.max(1, Math.exp(Math.log(H) + Z975 * seLnH));
    i2Lo = (hLo * hLo - 1) / (hLo * hLo);
    i2Hi = (hHi * hHi - 1) / (hHi * hHi);
  }
  let pi: { lo: number; hi: number } | null = null;
  if (k >= 3) {
    const t = tQuantile(0.975, k - 2);
    const s = Math.sqrt(tau2 + random.se * random.se);
    pi = { lo: muR - t * s, hi: muR + t * s };
  }
  return {
    k,
    fixed: fixedOverride ?? ivFixed,
    random,
    tau2,
    tauMethod,
    Q,
    df,
    pQ: chiSquareP(Q, df),
    i2,
    i2Lo,
    i2Hi,
    pi,
    wFixed: w.map((x) => (100 * x) / sw),
    wRandom: wr.map((x) => (100 * x) / swr),
    remlIterations,
  };
}

export const EGGER_MIN_STUDIES = 10;

export interface EggerFit {
  k: number;
  intercept: number;
  se: number;
  t: number;
  df: number;
  p: number;
  lo: number;
  hi: number;
  slope: number;
}

/** Egger's regression test (refuses below EGGER_MIN_STUDIES studies). */
export function eggerTest(y: number[], v: number[]): EggerFit | { error: string } {
  const k = y.length;
  if (k < EGGER_MIN_STUDIES) {
    return {
      error:
        `Egger's test needs at least ${EGGER_MIN_STUDIES} studies (there ${k === 1 ? "is 1" : `are ${k}`}): with fewer, it has too little power to tell ` +
        "small-study effects from chance (Sterne et al. 2011, BMJ 343:d4002), so it is not run.",
    };
  }
  const x = v.map((s) => 1 / Math.sqrt(s));
  const z = y.map((yi, i) => yi * x[i]);
  const mx = x.reduce((s, a) => s + a, 0) / k;
  const mz = z.reduce((s, a) => s + a, 0) / k;
  const sxx = x.reduce((s, a) => s + (a - mx) ** 2, 0);
  if (!(sxx > 0)) return { error: "Every study has the same standard error, so the Egger regression has no spread in precision to fit." };
  const sxz = x.reduce((s, a, i) => s + (a - mx) * (z[i] - mz), 0);
  const slope = sxz / sxx;
  const intercept = mz - slope * mx;
  const ssr = z.reduce((s, zi, i) => s + (zi - intercept - slope * x[i]) ** 2, 0);
  const s2 = ssr / (k - 2);
  const se = Math.sqrt(s2 * (1 / k + (mx * mx) / sxx));
  const t = intercept / se;
  const tq = tQuantile(0.975, k - 2);
  return { k, intercept, se, t, df: k - 2, p: tTestP(Math.abs(t), k - 2), lo: intercept - tq * se, hi: intercept + tq * se, slope };
}
