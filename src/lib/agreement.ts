/**
 * Agreement (v2.206.0): Cohen's kappa (unweighted, linear and quadratic weights), Bland–Altman limits of agreement,
 * and the intraclass correlation coefficients of Shrout & Fleiss (1979) / McGraw & Wong (1996). Pure functions; the
 * pane glue is clinicalStatCalcs.ts.
 *
 * Conventions (printed with the result):
 *  - Kappa: κ = (pₒ − pₑ)/(1 − pₑ) with agreement weights w = 1 (unweighted: diagonal only), 1 − |i − j|/(k − 1)
 *    (linear) or 1 − (i − j)²/(k − 1)² (quadratic). Standard errors are the large-sample ones of Fleiss, Cohen &
 *    Everitt (1969, Psychol Bull 72:323): the non-null SE for the interval, the null SE for the z test of κ = 0.
 *  - Bland & Altman (1986, Lancet i:307; 1999, Stat Methods Med Res 8:135): bias d̄, limits d̄ ± 1.96·s (or ± 2·s, as
 *    the 1986 paper), the interval of the bias d̄ ± t·s/√n and of each limit ± t·s·√(3/n), t on n − 1 df. Proportional
 *    bias: the least-squares slope of the difference on the mean, with its t test.
 *  - ICC from the two-way ANOVA of an n targets × k raters table: ICC(1,1) one-way random, ICC(2,1) two-way random
 *    absolute agreement, ICC(3,1) two-way mixed consistency, and the average-measures forms ICC(1,k), (2,k), (3,k).
 *    Intervals by the F method of McGraw & Wong (1996, Psychol Methods 1:30), with the Satterthwaite df for ICC(2,·).
 */
import { fQuantile, tQuantile, Z975 } from "./clinicalCore";
import { fTestP, tTestP } from "./stats";
import { normalCdfPrecise } from "./probdist";

export type KappaWeight = "none" | "linear" | "quadratic";

export interface KappaFit {
  k: number;
  n: number;
  po: number;
  pe: number;
  kappa: number;
  se: number;
  se0: number;
  lo: number;
  hi: number;
  z: number;
  p: number;
  /** True when the Wald interval ran past −1 or 1 and was clipped. */
  clipped: boolean;
  /** Observed and chance-expected counts on the diagonal, per category. */
  diagObs: number[];
  diagExp: number[];
}

/** Cohen's kappa of a k×k table (rows rater A, columns rater B, categories in the same order). */
export function cohenKappa(table: number[][], weight: KappaWeight): KappaFit | { error: string } {
  const k = table.length;
  if (k < 2 || table.some((r) => r.length !== k)) return { error: "Enter a square table: one row and one column per category, in the same order (at least 2 categories)." };
  for (const r of table) for (const v of r) if (!Number.isFinite(v) || v < 0) return { error: "Counts must be numbers ≥ 0." };
  const n = table.flat().reduce((s, v) => s + v, 0);
  if (!(n > 0)) return { error: "Every count is zero: there are no ratings." };
  const P = table.map((r) => r.map((v) => v / n));
  const row = P.map((r) => r.reduce((s, v) => s + v, 0));
  const col = P[0].map((_, j) => P.reduce((s, r) => s + r[j], 0));
  const W = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (weight === "none" ? (i === j ? 1 : 0) : weight === "linear" ? 1 - Math.abs(i - j) / (k - 1) : 1 - ((i - j) * (i - j)) / ((k - 1) * (k - 1)))),
  );
  let po = 0;
  let pe = 0;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      po += W[i][j] * P[i][j];
      pe += W[i][j] * row[i] * col[j];
    }
  if (pe >= 1 - 1e-12) {
    const used = row.map((r, i) => (r > 0 || col[i] > 0 ? i + 1 : 0)).filter(Boolean);
    return {
      error:
        `Chance agreement is 100% (both raters put every subject in category ${used.join(", ")}), so kappa is 0/0 and cannot be ` +
        "estimated. Agreement is complete but uninformative: use the observed agreement, or rate subjects that vary.",
    };
  }
  const kappa = (po - pe) / (1 - pe);
  const wRow = Array.from({ length: k }, (_, i) => col.reduce((s, c, j) => s + c * W[i][j], 0));
  const wCol = Array.from({ length: k }, (_, j) => row.reduce((s, r, i) => s + r * W[i][j], 0));
  let a = 0;
  let a0 = 0;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      const t = W[i][j] - (wRow[i] + wCol[j]) * (1 - kappa);
      a += P[i][j] * t * t;
      const t0 = W[i][j] - (wRow[i] + wCol[j]);
      a0 += row[i] * col[j] * t0 * t0;
    }
  const varK = (a - (kappa - pe * (1 - kappa)) ** 2) / (n * (1 - pe) ** 2);
  const var0 = (a0 - pe * pe) / (n * (1 - pe) ** 2);
  const se = Math.sqrt(Math.max(0, varK));
  const se0 = Math.sqrt(Math.max(0, var0));
  const z = se0 > 0 ? kappa / se0 : NaN;
  return {
    k,
    n,
    po,
    pe,
    kappa,
    se,
    se0,
    // Clipped to κ's range [−1, 1] (review M3: "20 1 / 0 20" gave 0.857 to 1.046); `clipped` says so.
    lo: Math.max(-1, kappa - Z975 * se),
    hi: Math.min(1, kappa + Z975 * se),
    clipped: kappa - Z975 * se < -1 || kappa + Z975 * se > 1,
    z,
    p: Number.isFinite(z) ? 2 * normalCdfPrecise(-Math.abs(z)) : NaN,
    diagObs: table.map((r, i) => r[i]),
    diagExp: row.map((r, i) => r * col[i] * n),
  };
}

/** Landis & Koch (1977) words for a kappa. */
export function landisKoch(k: number): string {
  if (k < 0) return "poor (below chance)";
  if (k <= 0.2) return "slight";
  if (k <= 0.4) return "fair";
  if (k <= 0.6) return "moderate";
  if (k <= 0.8) return "substantial";
  return "almost perfect";
}

export interface BlandAltman {
  n: number;
  diffs: number[];
  means: number[];
  bias: number;
  sd: number;
  mult: number;
  lower: number;
  upper: number;
  biasCi: [number, number];
  lowerCi: [number, number];
  upperCi: [number, number];
  slope: number;
  intercept: number;
  slopeSe: number;
  slopeP: number;
  /** The differences are constant (to rounding): proportional bias cannot be tested. */
  constantDiffs: boolean;
  t: number;
}

/** Bland–Altman analysis of paired measurements a (method A) and b (method B); difference = A − B. */
export function blandAltman(a: number[], b: number[], mult: number): BlandAltman | { error: string } {
  const n = a.length;
  if (n !== b.length) return { error: "The two methods need the same number of measurements." };
  if (n < 3) return { error: `Bland–Altman needs at least 3 pairs (there ${n === 1 ? "is 1" : `are ${n}`}): the limits need a standard deviation and the proportional-bias check a regression line.` };
  const diffs = a.map((v, i) => v - b[i]);
  const means = a.map((v, i) => (v + b[i]) / 2);
  const bias = diffs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(diffs.reduce((s, v) => s + (v - bias) ** 2, 0) / (n - 1));
  const t = tQuantile(0.975, n - 1);
  const seB = sd / Math.sqrt(n);
  const seL = sd * Math.sqrt(3 / n);
  const lower = bias - mult * sd;
  const upper = bias + mult * sd;
  const mx = means.reduce((s, v) => s + v, 0) / n;
  const sxx = means.reduce((s, v) => s + (v - mx) ** 2, 0);
  let sxy = 0;
  for (let i = 0; i < n; i++) sxy += (means[i] - mx) * (diffs[i] - bias);
  const slope = sxx > 0 ? sxy / sxx : NaN;
  const intercept = bias - slope * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (diffs[i] - intercept - slope * means[i]) ** 2;
  const slopeSe = sxx > 0 && n > 2 ? Math.sqrt(ssr / (n - 2) / sxx) : NaN;
  // A zero residual SE with a zero slope means the differences are constant (review B3: A = 1..4, B = 2..5 printed
  // "proportional bias, p < 0.001"): there is nothing to test, so p is not a number and the result says so. A zero
  // residual SE with a non-zero slope is differences exactly proportional to the mean: p = 0 is the honest answer.
  let mag = 0;
  for (let i = 0; i < n; i++) mag = Math.max(mag, Math.abs(means[i]), Math.abs(diffs[i]));
  // "Constant" to rounding: 1.1 − 2.2, 2.1 − 3.2 … differ in the 16th digit only.
  const constantDiffs = sd <= 1e-12 * mag;
  const slopeP = constantDiffs ? NaN : slopeSe > 0 ? tTestP(Math.abs(slope / slopeSe), n - 2) : slopeSe === 0 ? 0 : NaN;
  return {
    n,
    diffs,
    means,
    bias,
    sd,
    mult,
    lower,
    upper,
    biasCi: [bias - t * seB, bias + t * seB],
    lowerCi: [lower - t * seL, lower + t * seL],
    upperCi: [upper - t * seL, upper + t * seL],
    slope,
    intercept,
    slopeSe,
    slopeP,
    constantDiffs,
    t,
  };
}

export interface IccRow {
  /** "ICC(1,1)" … "ICC(3,k)". */
  form: string;
  description: string;
  value: number;
  lo: number;
  hi: number;
  F: number;
  df1: number;
  df2: number;
  p: number;
}

export interface IccFit {
  n: number;
  k: number;
  msr: number;
  msc: number;
  mse: number;
  msw: number;
  rows: IccRow[];
}

/** The six ICCs of an n × k table (rows targets, columns raters), complete data. */
export function iccFit(Y: number[][]): IccFit | { error: string } {
  const n = Y.length;
  const k = Y[0]?.length ?? 0;
  if (n < 2) return { error: "The ICC needs at least 2 targets (rows)." };
  if (k < 2) return { error: "The ICC needs at least 2 raters (columns)." };
  if (Y.some((r) => r.length !== k || r.some((v) => !Number.isFinite(v)))) return { error: "Every target needs a rating from every rater: the table must be complete." };
  const grand = Y.flat().reduce((s, v) => s + v, 0) / (n * k);
  const rowM = Y.map((r) => r.reduce((s, v) => s + v, 0) / k);
  const colM = Array.from({ length: k }, (_, j) => Y.reduce((s, r) => s + r[j], 0) / n);
  const ssr = k * rowM.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssc = n * colM.reduce((s, m) => s + (m - grand) ** 2, 0);
  const sst = Y.flat().reduce((s, v) => s + (v - grand) ** 2, 0);
  const sse = sst - ssr - ssc;
  if (!(sst > 0)) return { error: "Every rating is the same value: there is no variance between targets, so the ICC is 0/0." };
  const msr = ssr / (n - 1);
  const msc = ssc / (k - 1);
  const mse = sse / ((n - 1) * (k - 1));
  const msw = (ssc + sse) / (n * (k - 1));
  if (!(msr > 0)) return { error: "Every target has the same mean rating: the between-target variance is 0, so the ICC is not defined." };
  const icc1 = (msr - msw) / (msr + (k - 1) * msw);
  const icc2 = (msr - mse) / (msr + (k - 1) * mse + (k * (msc - mse)) / n);
  const icc3 = (msr - mse) / (msr + (k - 1) * mse);
  const icc1k = (msr - msw) / msr;
  const icc2k = (msr - mse) / (msr + (msc - mse) / n);
  const icc3k = (msr - mse) / msr;
  const q = 0.975;
  // ICC(1,·)
  const df1 = n - 1;
  const df21 = n * (k - 1);
  const f1 = msr / msw;
  const f1L = f1 / fQuantile(q, df1, df21);
  const f1U = f1 * fQuantile(q, df21, df1);
  // ICC(3,·)
  const df23 = (n - 1) * (k - 1);
  const f3 = msr / mse;
  const f3L = f3 / fQuantile(q, df1, df23);
  const f3U = f3 * fQuantile(q, df23, df1);
  // ICC(2,·), Satterthwaite df (McGraw & Wong 1996, Table 7; as pingouin and R's psych).
  const fc = msc / mse;
  const vn = (k - 1) * (n - 1) * (k * icc2 * fc + n * (1 + (k - 1) * icc2) - k * icc2) ** 2;
  const vd = (n - 1) * k * k * icc2 * icc2 * fc * fc + (n * (1 + (k - 1) * icc2) - k * icc2) ** 2;
  const v = vn / vd;
  const f2U = fQuantile(q, n - 1, v);
  const f2L = fQuantile(q, v, n - 1);
  const lb2 = (n * (msr - f2U * mse)) / (f2U * (k * msc + (k * n - k - n) * mse) + n * msr);
  const ub2 = (n * (f2L * msr - mse)) / (k * msc + (k * n - k - n) * mse + n * f2L * msr);
  const avg = (x: number): number => (x * k) / (1 + x * (k - 1));
  const p1 = fTestP(f1, df1, df21);
  const p3 = fTestP(f3, df1, df23);
  return {
    n,
    k,
    msr,
    msc,
    mse,
    msw,
    rows: [
      { form: "ICC(1,1)", description: "one-way random, single rater", value: icc1, lo: (f1L - 1) / (f1L + k - 1), hi: (f1U - 1) / (f1U + k - 1), F: f1, df1, df2: df21, p: p1 },
      { form: "ICC(2,1)", description: "two-way random, absolute agreement, single rater", value: icc2, lo: lb2, hi: ub2, F: f3, df1, df2: df23, p: p3 },
      { form: "ICC(3,1)", description: "two-way mixed, consistency, single rater", value: icc3, lo: (f3L - 1) / (f3L + k - 1), hi: (f3U - 1) / (f3U + k - 1), F: f3, df1, df2: df23, p: p3 },
      { form: "ICC(1,k)", description: "one-way random, mean of k raters", value: icc1k, lo: 1 - 1 / f1L, hi: 1 - 1 / f1U, F: f1, df1, df2: df21, p: p1 },
      { form: "ICC(2,k)", description: "two-way random, absolute agreement, mean of k raters", value: icc2k, lo: avg(lb2), hi: avg(ub2), F: f3, df1, df2: df23, p: p3 },
      { form: "ICC(3,k)", description: "two-way mixed, consistency, mean of k raters", value: icc3k, lo: 1 - 1 / f3L, hi: 1 - 1 / f3U, F: f3, df1, df2: df23, p: p3 },
    ],
  };
}

/** Koo & Li (2016, J Chiropr Med 15:155) words for an ICC. */
export function kooLi(v: number): string {
  if (v < 0.5) return "poor";
  if (v < 0.75) return "moderate";
  if (v <= 0.9) return "good";
  return "excellent";
}
