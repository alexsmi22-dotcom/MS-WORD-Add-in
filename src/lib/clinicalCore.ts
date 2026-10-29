/**
 * Shared numerics for the clinical-research Stats calculators (v2.206.0): binomial proportion intervals (Wilson score,
 * Clopper–Pearson exact), distribution quantiles by bisection over the product's own CDFs, the exact two-sided binomial
 * test, and the number formatting the clinical results share. Pure functions, no pane imports.
 *
 * Every interval here is two-sided at 95% unless a caller passes another level.
 */
import { incompleteBeta, gammaln } from "./stats";
import { fCdf, tCdf, quantile } from "./power";
import { normalQuantile } from "./probdist";
import { fmtFixed } from "./regTable";

export const Z975 = 1.959963984540054;

export type PropCiMethod = "wilson" | "cp";
export const PROP_CI_NAME: Record<PropCiMethod, string> = { wilson: "Wilson score", cp: "Clopper–Pearson exact" };

/** The beta quantile: the x in [0, 1] with I_x(a, b) = p (bisection; I is monotone in x). */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return (lo + hi) / 2;
}

/** A 95% (or 1 − alpha) interval for x successes of n. Wilson score or Clopper–Pearson exact. */
export function propCi(x: number, n: number, method: PropCiMethod, alpha = 0.05): { lo: number; hi: number } {
  if (!(n > 0)) return { lo: NaN, hi: NaN };
  if (method === "cp") {
    const lo = x <= 0 ? 0 : betaQuantile(alpha / 2, x, n - x + 1);
    const hi = x >= n ? 1 : betaQuantile(1 - alpha / 2, x + 1, n - x);
    return { lo, hi };
  }
  const z = alpha === 0.05 ? Z975 : normalQuantile(1 - alpha / 2);
  const p = x / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (z / den) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

/** The F quantile P(F ≤ f) = p (df may be fractional: the ICC(2,1) interval uses a Satterthwaite df). */
export function fQuantile(p: number, df1: number, df2: number): number {
  return quantile((x) => fCdf(x, df1, df2), p, 0, 10);
}

/** The t quantile P(T ≤ t) = p, p > 0.5. */
export function tQuantile(p: number, df: number): number {
  return quantile((x) => tCdf(x, df), p, 0, 10);
}

/** log of C(n, k). */
export function lnChoose(n: number, k: number): number {
  return gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1);
}

/**
 * The exact two-sided binomial test of x successes in n against p0: the sum of the probabilities of every outcome no
 * more likely than the one observed (the convention of scipy.stats.binomtest and R's binom.test), with a relative
 * tolerance so outcomes of equal probability reached by different rounding are counted together.
 */
export function binomTwoSided(x: number, n: number, p0: number): number {
  if (p0 <= 0) return x === 0 ? 1 : 0;
  if (p0 >= 1) return x === n ? 1 : 0;
  const lp = (k: number): number => lnChoose(n, k) + k * Math.log(p0) + (n - k) * Math.log1p(-p0);
  const obs = lp(x);
  let s = 0;
  for (let k = 0; k <= n; k++) {
    const l = lp(k);
    if (l <= obs + 1e-7 * Math.max(1, Math.abs(obs))) s += Math.exp(l);
  }
  return Math.min(1, s);
}

/** A percentage with `d` decimals ("90.0%"), U+2212 for a negative, "" for a non-finite value. */
export function pct(v: number, d = 1): string {
  const s = fmtFixed(100 * v, d);
  return s ? `${s}%` : "";
}

/** A value with `d` decimals under the display contract (fmtFixed: U+2212, ×10ⁿ for the very small or large). */
export function fx(v: number, d = 2): string {
  return fmtFixed(v, d);
}

/** "[lo; hi]" style interval text used in tables: "83.2% to 94.3%". */
export function pctCi(lo: number, hi: number, d = 1): string {
  return `${pct(lo, d)} to ${pct(hi, d)}`;
}

export function fxCi(lo: number, hi: number, d = 2): string {
  return `${fx(lo, d)} to ${fx(hi, d)}`;
}

/** Reads a whole number ≥ 0 from a field: commas as thousands separators, U+2212 minus refused as a count. */
export function readCount(raw: string, label: string): number | { error: string } {
  const t = (raw ?? "").trim().replace(/,(?=\d{3}\b)/g, "");
  if (!t) return { error: `${label}: enter a count.` };
  const v = Number(t.replace(/[−–]/g, "-"));
  if (!Number.isFinite(v)) return { error: `${label}: “${raw.trim()}” is not a number.` };
  if (v < 0) return { error: `${label}: a count cannot be negative.` };
  if (!Number.isInteger(v)) return { error: `${label}: “${raw.trim()}” is not a whole number of people.` };
  if (v > 1e9) return { error: `${label}: ${raw.trim()} is too large (the limit is 10⁹).` };
  return v;
}

/** Reads a real number from a field ("0.9", "90%", "−1.5"); `percent` lets "90%" or "90" stand for 0.9. */
export function readReal(raw: string, label: string, opts: { percent?: boolean } = {}): number | { error: string } {
  let t = (raw ?? "").trim().replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!t) return { error: `${label}: enter a number.` };
  let isPct = false;
  if (t.endsWith("%")) {
    isPct = true;
    t = t.slice(0, -1);
  }
  const v = Number(t);
  if (!Number.isFinite(v)) return { error: `${label}: “${raw.trim()}” is not a number.` };
  if (opts.percent && (isPct || v > 1)) return v / 100;
  return v;
}
