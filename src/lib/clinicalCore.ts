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
  const lp0 = Math.log(p0);
  const lq0 = Math.log1p(-p0);
  const lp = (k: number): number => lnChoose(n, k) + k * lp0 + (n - k) * lq0;
  const obs = lp(x);
  const tol = 1e-7 * Math.max(1, Math.abs(obs));
  const small = (k: number): boolean => lp(k) <= obs + tol;
  // The pmf is unimodal: the outcomes no more likely than x are two tails, [0, kL] and [kU, n]. The tail on x's side
  // starts at x; the other is found by bisection from the mode. Each tail is summed OUTWARD from its boundary and stops
  // once the terms no longer change the sum (review B1: a loop over all n + 1 outcomes hung at a + c ≈ 10⁹). The work
  // is of the order of the standard deviation, not n.
  const mode = Math.min(n, Math.max(0, Math.floor((n + 1) * p0)));
  let kL: number;
  let kU: number;
  if (x <= mode) {
    kL = x;
    // smallest k > mode with pmf(k) ≤ pmf(x), or n + 1 when none
    let lo = mode + 1;
    let hi = n + 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (small(mid)) hi = mid;
      else lo = mid + 1;
    }
    kU = lo;
  } else {
    kU = x;
    // largest k < mode with pmf(k) ≤ pmf(x), or −1 when none
    let lo = -1;
    let hi = mode - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (small(mid)) lo = mid;
      else hi = mid - 1;
    }
    kL = lo;
  }
  const tail = (start: number, step: 1 | -1): number => {
    let s = 0;
    for (let k = start, i = 0; k >= 0 && k <= n; k += step, i++) {
      const t = Math.exp(lp(k));
      s += t;
      if (i > 10 && t <= 1e-17 * s) break;
      if (t === 0 && i > 10) break;
    }
    return s;
  };
  const s = (kL >= 0 ? tail(kL, -1) : 0) + (kU <= n ? tail(kU, 1) : 0);
  return Math.min(1, s);
}

/** A percentage with `d` decimals ("90.0%"), U+2212 for a negative, "" for a non-finite value. */
export function pct(v: number, d = 1): string {
  const a = Math.abs(100 * v);
  // A small non-zero percentage keeps two significant figures ("0.0059%"), never "0.0%" or ×10ⁿ.
  if (a > 0 && a < 0.5 * Math.pow(10, -d) && a >= 1e-6) {
    const t = a.toPrecision(2);
    return `${v < 0 ? "−" : ""}${Number(t).toFixed(Math.max(d, 1 - Math.floor(Math.log10(a)) ))}%`;
  }
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

/**
 * One formatter for a ratio and its interval (review MINOR: "0.12 (0.0044 to 0.21)" mixed formats): every value in
 * `vals` gets the same decimals, enough to show the smallest positive one to two significant figures (2 to 6).
 */
export function ratioFmt(vals: number[]): (v: number) => string {
  let m = Infinity;
  for (const v of vals) if (Number.isFinite(v) && v > 0 && v < m) m = v;
  const d = Number.isFinite(m) ? Math.max(2, Math.min(6, 1 - Math.floor(Math.log10(m)))) : 2;
  return (v: number): string => fmtFixed(v, d);
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
  // Thousands separators ("28,010", "1,250.5"; review M7): only a correctly grouped number loses its commas.
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?%?$/.test(t)) t = t.replace(/,/g, "");
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
