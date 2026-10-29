/**
 * The nonparametric bootstrap (Release E4c): B resamples of the n rows drawn with replacement from PCG32 (prng.ts,
 * unbiased bounded integers), one statistic per resample, and four confidence intervals.
 *
 * CONVENTIONS (scipy 1.18 scipy/stats/_resampling.py, `bootstrap`, read line by line):
 *   - α = (1 − confidence)/2, computed as that expression (0.025000000000000022 for 95%, as scipy holds it).
 *   - Quantiles of the bootstrap distribution: Hyndman–Fan type 7 (scipy.stats.quantile method "linear", scipy's
 *     default): jg = p·B + (1 − p), j = floor(jg) − 1, g = jg mod 1, value (1 − g)·θ*₍ⱼ₎ + g·θ*₍ⱼ₊₁₎, indices clipped
 *     to 0 … B − 1.
 *   - percentile: [q(α), q(1 − α)].  basic: [2θ − q(1 − α), 2θ − q(α)].
 *   - BCa (Efron & Tibshirani 1993, eq. 14.14 and 15.36, as scipy's _bca_interval): z₀ = Φ⁻¹(p₀) with
 *     p₀ = (#{θ* < θ} + #{θ* ≤ θ})/(2B), so ties with θ count one half; the acceleration from the leave-one-out
 *     jackknife, U = (n − 1)(θ̄₍.₎ − θ₍ᵢ₎), â = ΣU³/(6(ΣU²)^{3/2}); α₁ = Φ(z₀ + (z₀ + z_α)/(1 − â(z₀ + z_α))), α₂ the
 *     same with z₁₋α; interval [q(α₁), q(α₂)].
 *   - normal: scipy has no normal interval. This is R boot.ci's type "norm" (Davison & Hinkley 1997, eq. 5.5):
 *     (θ − bias) ± z₁₋α·SE, with bias = mean(θ*) − θ and SE the standard deviation of θ* (divisor B − 1, as scipy's
 *     standard_error).
 *   - Two-column statistics resample ROWS (pairs), as scipy's paired=True: one index vector, and the jackknife leaves
 *     out one row.
 *
 * STATISTICS: mean; median (the middle value, or the mean of the two middle values); standard deviation and variance
 * with divisor n − 1; 10% trimmed mean as scipy.stats.trim_mean(x, 0.1) (floor(0.1·n) values cut from EACH end);
 * Pearson correlation; ratio of means ȳ/x̄; least-squares slope of y on x (Sxy/Sxx, centred sums).
 *
 * UNDEFINED RESAMPLES (a correlation or slope whose resample has a constant column, a ratio whose resampled x̄ is 0):
 * the replicate is DROPPED and counted, as Stata's bootstrap does with a failed replicate ("insufficient
 * observations"), not redrawn: a redraw would silently condition the distribution on the resample being usable. The
 * intervals use the remaining replicates and the count is printed; more than 10% dropped is refused by name.
 *
 * RATIO OF MEANS: a full-sample x̄ that is zero up to rounding (|Σx| ≤ n·ε·Σ|x|, the rounding bound of the sum) is
 * refused, and so is any run in which a resampled x̄ has the other sign from x̄ or is 0: the ratio then passes
 * through infinity and its bootstrap distribution is unbounded (the run reports how many resamples crossed, and the
 * range of the resampled x̄).
 *
 * FREEZE GUARANTEE: the work n·B·(cost of the statistic) is charged up front against BOOT_MAX_WORK (refused by name
 * above it), and the wall clock is checked every 8 replicates against BOOT_WALL_MS.
 */
import { Pcg32 } from "./prng";
import { normalCdfPrecise, normalQuantile } from "./probdist";

// Bound once (see prng.ts: a `Math.x` lookup is ~20× slower under jest than a local alias).
const mSqrt = Math.sqrt;
const mFloor = Math.floor;

export type BootStat = "mean" | "median" | "sd" | "var" | "trim10" | "corr" | "ratio" | "slope";

export const BOOT_STATS: { value: BootStat; label: string; twoColumn: boolean }[] = [
  { value: "mean", label: "Mean", twoColumn: false },
  { value: "median", label: "Median", twoColumn: false },
  { value: "sd", label: "Standard deviation", twoColumn: false },
  { value: "var", label: "Variance", twoColumn: false },
  { value: "trim10", label: "10% trimmed mean", twoColumn: false },
  { value: "corr", label: "Correlation of two columns", twoColumn: true },
  { value: "ratio", label: "Ratio of means (ȳ/x̄)", twoColumn: true },
  { value: "slope", label: "Regression slope (y ~ x, pairs resampling)", twoColumn: true },
];

export type BootMethod = "percentile" | "basic" | "normal" | "bca";

/** Wall-clock limit of one bootstrap, as arima.ts ARIMA_WALL_MS. */
export const BOOT_WALL_MS = 6000;
/**
 * Work units allowed (bootWork: n·B times the statistic's per-element cost). Runs at the limit measured 1.0–2.6 s on
 * the build machine for every statistic (mean n = 40,000 B = 1,900; median n = 20,000 B = 600; corr n = 3,000
 * B = 13,600 …), so they finish inside BOOT_WALL_MS; a slower machine meets the wall clock's named refusal instead.
 */
// Lowered from 8×10⁷ (2026-10-28 bug test, R4 #7: the median at n = 2,000, B = 5,000 took 1.7 s and the mean at
// n = 2,000, B = 20,000 took 2.1 s, both under the old limit). At 2.5×10⁷ the worst run allowed is about 0.5–1 s.
export const BOOT_MAX_WORK = 2.5e7;
export const BOOT_MIN_N = 5;
export const BOOT_MIN_B = 100;
export const BOOT_MAX_B = 20000;
/** More than this share of undefined replicates is refused. */
export const BOOT_MAX_DROP_SHARE = 0.1;
/** Up to this n the jackknife recomputes each leave-one-out statistic directly (as scipy does); above it, downdates. */
export const JACK_DIRECT_MAX = 4000;

export interface BootInput {
  stat: BootStat;
  /** The one column, or y (numerator / response) of a two-column statistic. */
  y: Float64Array;
  /** x of a two-column statistic (denominator / regressor). */
  x?: Float64Array;
  B: number;
  /** Confidence level as a fraction (0.95). */
  confidence: number;
  seed: number;
  /** Internal: wall-clock limit override (tests). */
  wallMs?: number;
  /** Internal: jackknife direct-recompute threshold override (tests). */
  jackDirectMax?: number;
}

export interface Interval {
  lo: number;
  hi: number;
}

export interface BootResult {
  ok: true;
  n: number;
  thetaHat: number;
  /** The usable replicates in draw order. */
  reps: Float64Array;
  /** Replicates dropped as undefined. */
  dropped: number;
  se: number;
  bias: number;
  alpha: number;
  percentile: Interval;
  basic: Interval;
  normal: Interval;
  /** BCa, or the reason it is not available. */
  bca: (Interval & { z0: number; a: number; alpha1: number; alpha2: number }) | { refused: string };
  /** Leave-one-out statistics (for tests and the oracle). */
  jack: Float64Array | null;
}

export type BootOutcome = BootResult | { ok: false; reason: string; denominatorCrossed?: { count: number; min: number; max: number } };

const isTwo = (s: BootStat): boolean => s === "corr" || s === "ratio" || s === "slope";

/**
 * The work in millions with just enough decimals to show it over the limit (fix round 3 S-m3: 2,449 rows × 2,000
 * replicates of the median printed "about 25 million steps; the limit is 25 million").
 */
function overLimitMillions(work: number, limit: number): string {
  const lim = Math.round(limit / 1e6);
  for (let dp = 0; dp < 6; dp++) {
    const s = (work / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    if (Number(s.replace(/,/g, "")) > lim) return s;
  }
  return (work / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** Hyndman–Fan type 7 on a SORTED array, in scipy's operation order. */
export function quantileType7(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  const jg = p * n + (1 - p);
  const jp1 = mFloor(jg);
  let j = jp1 - 1;
  let g = jg % 1;
  if (j < 0) g = 0;
  j = Math.min(Math.max(j, 0), n - 1);
  const k = Math.min(Math.max(jp1, 0), n - 1);
  return (1 - g) * sorted[j] + g * sorted[k];
}

/** The most replicates (a whole hundred) that fit BOOT_MAX_WORK for n rows; below BOOT_MIN_B when none do. */
export function bootMaxB(stat: BootStat, n: number): number {
  const per = bootWork(stat, n, 1) - bootWork(stat, n, 0);
  const B = Math.floor((BOOT_MAX_WORK - bootWork(stat, n, 0)) / per);
  return Math.min(BOOT_MAX_B, Math.floor(B / 100) * 100);
}

/** The most rows that fit BOOT_MAX_WORK at B replicates (bisection; the work grows with n). */
export function bootMaxN(stat: BootStat, B: number): number {
  let lo = BOOT_MIN_N;
  let hi = 1e7;
  if (bootWork(stat, lo, B) > BOOT_MAX_WORK) return 0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (bootWork(stat, mid, B) <= BOOT_MAX_WORK) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Work units of one bootstrap, the figure the up-front refusal tests. */
export function bootWork(stat: BootStat, n: number, B: number): number {
  const perElement = BOOT_ELEMENT_COST[stat] * (stat === "median" || stat === "trim10" ? 1 + Math.log2(Math.max(2, n)) : 1);
  // The jackknife: median by ranks (n), trimmed mean by direct sums over the sorted values (n²), the others by a
  // direct recomputation per left-out row (n² elements) up to JACK_DIRECT_MAX, downdating (≈ 4n) above it.
  const jack = n <= JACK_DIRECT_MAX ? (stat === "median" ? n : stat === "trim10" ? n * n : perElement * n * n) : 4 * n;
  return B * n * perElement + jack;
}

/**
 * Cost of one resampled element, in units of the mean's (≈ 21 ns on the build machine: one PCG32 draw, one gather,
 * one add), measured at 2×10⁸ units: mean (n = 100,000, B = 2,000) 4.2 s; slope 6.5 s (×1.6); median and trimmed mean
 * (n = 10,000, B = 1,400) 1.5–1.8 s, i.e. 0.37 per element per log₂n of the sort.
 */
// The ratio is charged one more pass than before (1.4 + 0.4): each resample's x̄ is also checked for a sign change.
const BOOT_ELEMENT_COST: Record<BootStat, number> = { mean: 1, sd: 1.2, var: 1.2, ratio: 1.8, corr: 1.6, slope: 1.6, median: 0.42, trim10: 0.42 };

// ---------------------------------------------------------------------------------------------------------------
// The statistics. Each returns NaN when undefined on these rows (dropped replicate).

function meanOf(v: ArrayLike<number>, m: number): number {
  let s = 0;
  for (let i = 0; i < m; i++) s += v[i];
  return s / m;
}

function ssOf(v: ArrayLike<number>, m: number, mu: number): number {
  let s = 0;
  for (let i = 0; i < m; i++) {
    const d = v[i] - mu;
    s += d * d;
  }
  return s;
}

function medianSorted(s: ArrayLike<number>, m: number): number {
  const h = m >> 1;
  return m % 2 === 1 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function trimSorted(s: ArrayLike<number>, m: number): number {
  const cut = mFloor(0.1 * m);
  let t = 0;
  for (let i = cut; i < m - cut; i++) t += s[i];
  return t / (m - 2 * cut);
}

function allEqual(v: ArrayLike<number>, m: number): boolean {
  const v0 = v[0];
  for (let i = 1; i < m; i++) if (v[i] !== v0) return false;
  return true;
}

/** The statistic of the first m values of a (and b for two-column statistics). `a` may be reordered (sorted). */
function statOf(stat: BootStat, a: Float64Array, b: Float64Array | null, m: number): number {
  switch (stat) {
    case "mean":
      return meanOf(a, m);
    case "median": {
      const s = a.subarray(0, m).sort();
      return medianSorted(s, m);
    }
    case "trim10": {
      const s = a.subarray(0, m).sort();
      return trimSorted(s, m);
    }
    case "sd":
    case "var": {
      const v = ssOf(a, m, meanOf(a, m)) / (m - 1);
      return stat === "sd" ? mSqrt(v) : v;
    }
    case "ratio": {
      const mx = meanOf(b!, m);
      if (mx === 0) return NaN;
      return meanOf(a, m) / mx;
    }
    case "corr":
    case "slope": {
      const y = a;
      const x = b!;
      if (allEqual(x, m) || (stat === "corr" && allEqual(y, m))) return NaN;
      const mx = meanOf(x, m);
      const my = meanOf(y, m);
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      for (let i = 0; i < m; i++) {
        const dx = x[i] - mx;
        const dy = y[i] - my;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
      }
      if (sxx === 0 || (stat === "corr" && syy === 0)) return NaN;
      // √Sxx·√Syy, not √(Sxx·Syy): the product overflows for columns near 10¹⁰⁰.
      return stat === "slope" ? sxy / sxx : sxy / (mSqrt(sxx) * mSqrt(syy));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The jackknife.

/** Leave-one-out statistics θ₍ᵢ₎, i = 0 … n − 1; NaN where undefined. */
export function jackknife(stat: BootStat, y: Float64Array, x: Float64Array | null, directMax = JACK_DIRECT_MAX): Float64Array {
  const n = y.length;
  const out = new Float64Array(n);
  if (stat === "median" || stat === "trim10") {
    // Sorted order once; leaving out row i removes one copy of its value (which copy does not matter).
    const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => y[i] - y[j] || i - j);
    const s = Float64Array.from(order, (i) => y[i]);
    const rank = new Int32Array(n);
    order.forEach((row, r) => (rank[row] = r));
    const m = n - 1;
    const at = (k: number, r: number): number => (k < r ? s[k] : s[k + 1]);
    if (stat === "median") {
      const h = m >> 1;
      for (let i = 0; i < n; i++) {
        const r = rank[i];
        out[i] = m % 2 === 1 ? at(h, r) : (at(h - 1, r) + at(h, r)) / 2;
      }
      return out;
    }
    const cut = mFloor(0.1 * m);
    if (n <= directMax) {
      for (let i = 0; i < n; i++) {
        const r = rank[i];
        let t = 0;
        for (let k = cut; k < m - cut; k++) t += at(k, r);
        out[i] = t / (m - 2 * cut);
      }
      return out;
    }
    const P = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) P[k + 1] = P[k] + s[k];
    const lo = cut;
    const hi = m - cut - 1;
    for (let i = 0; i < n; i++) {
      const r = rank[i];
      let t: number;
      if (hi < r) t = P[hi + 1] - P[lo];
      else if (lo >= r) t = P[hi + 2] - P[lo + 1];
      else t = P[r] - P[lo] + (P[hi + 2] - P[r + 1]);
      out[i] = t / (m - 2 * cut);
    }
    return out;
  }
  if (n <= directMax) {
    const a = new Float64Array(n - 1);
    const b = x ? new Float64Array(n - 1) : null;
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        a[k] = y[j];
        if (b) b[k] = x![j];
        k++;
      }
      out[i] = statOf(stat, a, b, n - 1);
    }
    return out;
  }
  // Downdating (large n): centred sums of the full sample, minus row i's share.
  const my = meanOf(y, n);
  const syy = ssOf(y, n, my);
  const f = n / (n - 1);
  if (stat === "mean") {
    let S = 0;
    for (let i = 0; i < n; i++) S += y[i];
    for (let i = 0; i < n; i++) out[i] = (S - y[i]) / (n - 1);
    return out;
  }
  if (stat === "sd" || stat === "var") {
    for (let i = 0; i < n; i++) {
      const d = y[i] - my;
      const v = Math.max(0, syy - f * d * d) / (n - 2);
      out[i] = stat === "sd" ? mSqrt(v) : v;
    }
    return out;
  }
  const xx = x!;
  const mx = meanOf(xx, n);
  if (stat === "ratio") {
    let Sy = 0;
    let Sx = 0;
    for (let i = 0; i < n; i++) {
      Sy += y[i];
      Sx += xx[i];
    }
    for (let i = 0; i < n; i++) {
      const den = Sx - xx[i];
      out[i] = den === 0 ? NaN : (Sy - y[i]) / den;
    }
    return out;
  }
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xx[i] - mx;
    sxx += dx * dx;
    sxy += dx * (y[i] - my);
  }
  for (let i = 0; i < n; i++) {
    const dx = xx[i] - mx;
    const dy = y[i] - my;
    const a = sxx - f * dx * dx;
    const c = sxy - f * dx * dy;
    const e = syy - f * dy * dy;
    if (!(a > 0) || (stat === "corr" && !(e > 0))) out[i] = NaN;
    else out[i] = stat === "slope" ? c / a : c / (mSqrt(a) * mSqrt(e));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

/** Runs the bootstrap. Inputs are assumed validated (finite values, n ≥ 5, B and confidence in range). */
export function runBootstrap(inp: BootInput): BootOutcome {
  const { stat, y, B, confidence, seed } = inp;
  const x = isTwo(stat) ? inp.x ?? null : null;
  const n = y.length;
  if (isTwo(stat) && (!x || x.length !== n)) return { ok: false, reason: "A two-column statistic needs two columns of the same length." };
  if (n < BOOT_MIN_N) return { ok: false, reason: `The bootstrap needs at least ${BOOT_MIN_N} rows; there are ${n}.` };
  if (!Number.isInteger(B) || B < BOOT_MIN_B || B > BOOT_MAX_B) {
    return { ok: false, reason: `Replicates B must be a whole number from ${BOOT_MIN_B} to ${BOOT_MAX_B.toLocaleString("en-US")}.` };
  }
  const work = bootWork(stat, n, B);
  if (work > BOOT_MAX_WORK) {
    // Round 2 (MINOR): name the replicates that would run for these rows (or, when even the minimum does not, the rows).
    const maxB = bootMaxB(stat, n);
    const remedy =
      maxB >= BOOT_MIN_B
        ? `Use at most ${maxB.toLocaleString("en-US")} replicates for these ${n.toLocaleString("en-US")} rows, or a sample of the rows.`
        : `Even ${BOOT_MIN_B} replicates are too many for ${n.toLocaleString("en-US")} rows; use a sample of at most ${bootMaxN(stat, B).toLocaleString("en-US")} rows for ${B.toLocaleString("en-US")} replicates.`;
    return {
      ok: false,
      reason:
        `${n.toLocaleString("en-US")} rows × ${B.toLocaleString("en-US")} replicates is more work than the bootstrap ` +
        `allows in one run (about ${overLimitMillions(work, BOOT_MAX_WORK)} million steps; the limit is ` +
        `${Math.round(BOOT_MAX_WORK / 1e6).toLocaleString("en-US")} million). ${remedy}`,
    };
  }
  const yy = y;
  if (stat === "ratio") {
    let sx = 0;
    let sa = 0;
    for (let i = 0; i < n; i++) {
      sx += x![i];
      sa += Math.abs(x![i]);
    }
    if (Math.abs(sx) <= n * Number.EPSILON * sa) {
      return {
        ok: false,
        reason:
          "The mean of the denominator column is 0 up to rounding (|Σx| is within n·ε·Σ|x| of zero, the rounding bound of the sum, ε = 2⁻⁵²), " +
          "so the ratio of means is undefined.",
      };
    }
  }
  const thetaHat = statOf(stat, Float64Array.from(yy), x ? Float64Array.from(x) : null, n);
  if (!Number.isFinite(thetaHat)) return { ok: false, reason: "The statistic is undefined on the full data (a constant column, or a zero mean in the denominator)." };
  const denSign = stat === "ratio" ? Math.sign(meanOf(Float64Array.from(x!), n)) : 0;
  let crossed = 0;
  let denMin = Infinity;
  let denMax = -Infinity;

  const wall = inp.wallMs ?? BOOT_WALL_MS;
  const started = Date.now();
  const rng = new Pcg32(seed);
  const a = new Float64Array(n);
  const b = x ? new Float64Array(n) : null;
  const reps = new Float64Array(B);
  const idx = new Int32Array(n);
  let kept = 0;
  let dropped = 0;
  for (let r = 0; r < B; r++) {
    if ((r & 7) === 7 && Date.now() - started > wall) {
      return {
        ok: false,
        reason: `The bootstrap ran past its ${wall / 1000} s time limit after ${r.toLocaleString("en-US")} of ${B.toLocaleString("en-US")} replicates; use fewer replicates or fewer rows.`,
      };
    }
    rng.fillBounded(idx, n);
    if (b) {
      const xx = x!;
      for (let i = 0; i < n; i++) {
        const k = idx[i];
        a[i] = yy[k];
        b[i] = xx[k];
      }
    } else {
      for (let i = 0; i < n; i++) a[i] = yy[idx[i]];
    }
    if (denSign !== 0) {
      const mx = meanOf(b!, n);
      if (Math.sign(mx) !== denSign) crossed++;
      if (mx < denMin) denMin = mx;
      if (mx > denMax) denMax = mx;
    }
    const t = statOf(stat, a, b, n);
    if (Number.isFinite(t)) reps[kept++] = t;
    else dropped++;
  }
  if (crossed > 0) {
    return {
      ok: false,
      denominatorCrossed: { count: crossed, min: denMin, max: denMax },
      reason:
        `In ${crossed.toLocaleString("en-US")} of ${B.toLocaleString("en-US")} resamples the mean of the denominator column is 0 or has the other sign from its full-sample mean, ` +
        "so the ratio of means passes through infinity across the resamples and its bootstrap distribution is unbounded: no interval is reported.",
    };
  }
  if (dropped > BOOT_MAX_DROP_SHARE * B) {
    return {
      ok: false,
      reason:
        `${dropped.toLocaleString("en-US")} of ${B.toLocaleString("en-US")} resamples left the statistic undefined ` +
        `(${statUndefinedWhy(stat)}), more than ${Math.round(BOOT_MAX_DROP_SHARE * 100)}%: the bootstrap distribution would ` +
        "be conditioned on the usable resamples. The data have too few distinct values for this statistic.",
    };
  }
  const used = reps.slice(0, kept);
  const Bv = kept;
  const sorted = Float64Array.from(used).sort();

  // Moments of θ* (scipy: standard_error = std(θ*, ddof = 1)).
  let s = 0;
  for (let i = 0; i < Bv; i++) s += used[i];
  const mstar = s / Bv;
  let ss = 0;
  for (let i = 0; i < Bv; i++) {
    const d = used[i] - mstar;
    ss += d * d;
  }
  const se = mSqrt(ss / (Bv - 1));
  const bias = mstar - thetaHat;

  const alpha = (1 - confidence) / 2;
  const percentile = { lo: quantileType7(sorted, alpha), hi: quantileType7(sorted, 1 - alpha) };
  const basic = { lo: 2 * thetaHat - percentile.hi, hi: 2 * thetaHat - percentile.lo };
  const z = -normalQuantile(alpha);
  const normal = { lo: thetaHat - bias - z * se, hi: thetaHat - bias + z * se };

  // BCa: z₀ first (no jackknife is spent when it is already infinite).
  let bca: BootResult["bca"];
  let jack: Float64Array | null = null;
  const p0 = bcaP0(used, thetaHat);
  if (p0 === 0 || p0 === 1) {
    bca = bcaInterval(sorted, thetaHat, new Float64Array(0), alpha);
  } else if (Date.now() - started > wall) {
    return { ok: false, reason: `The bootstrap ran past its ${wall / 1000} s time limit before the jackknife; use fewer replicates or fewer rows.` };
  } else {
    jack = jackknife(stat, yy, x, inp.jackDirectMax ?? JACK_DIRECT_MAX);
    bca = bcaInterval(sorted, thetaHat, jack, alpha);
  }
  return { ok: true, n, thetaHat, reps: used, dropped, se, bias, alpha, percentile, basic, normal, bca, jack };
}

/** p₀ = (#{θ* < θ} + #{θ* ≤ θ})/(2B): scipy's _percentile_of_score ("mean" kind). */
export function bcaP0(reps: ArrayLike<number>, thetaHat: number): number {
  let below = 0;
  let atOrBelow = 0;
  for (let i = 0; i < reps.length; i++) {
    if (reps[i] < thetaHat) below++;
    if (reps[i] <= thetaHat) atOrBelow++;
  }
  return (below + atOrBelow) / (2 * reps.length);
}

/**
 * The BCa interval from the sorted replicates, θ and the jackknife values (scipy's _bca_interval), or the reason it
 * cannot be formed: z₀ infinite (every replicate on one side of θ), an undefined leave-one-out statistic, or equal
 * jackknife values (0/0 acceleration).
 */
export function bcaInterval(sorted: Float64Array, thetaHat: number, jack: Float64Array, alpha: number): BootResult["bca"] {
  const p0 = bcaP0(sorted, thetaHat);
  if (p0 === 0 || p0 === 1) {
    return { refused: `every replicate lies ${p0 === 0 ? "above" : "below"} θ, so the bias correction z₀ is infinite` };
  }
  const n = jack.length;
  const badJ = jack.findIndex((v) => !Number.isFinite(v));
  if (badJ >= 0) return { refused: `leaving out row ${badJ + 1} makes the statistic undefined, so the jackknife acceleration cannot be formed` };
  let sj = 0;
  for (let i = 0; i < n; i++) sj += jack[i];
  const jbar = sj / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const u = (n - 1) * (jbar - jack[i]);
    num += u * u * u;
    den += u * u;
  }
  // scipy divides by n³ and n² before the ratio; the factors cancel in real arithmetic and are kept so the
  // floating-point steps are the same.
  const nums = num / (n * n * n);
  const dens = den / (n * n);
  if (!(dens > 0)) return { refused: "all the jackknife values are equal, so the acceleration is undefined (0/0)" };
  const ahat = ((1 / 6) * nums) / Math.pow(dens, 3 / 2);
  const z0 = normalQuantile(p0);
  const za = normalQuantile(alpha);
  const n1 = z0 + za;
  const alpha1 = normalCdfPrecise(z0 + n1 / (1 - ahat * n1));
  const n2 = z0 - za;
  const alpha2 = normalCdfPrecise(z0 + n2 / (1 - ahat * n2));
  if (!Number.isFinite(alpha1) || !Number.isFinite(alpha2) || !Number.isFinite(ahat)) {
    return { refused: "the BCa levels are not finite numbers for these replicates" };
  }
  return { lo: quantileType7(sorted, alpha1), hi: quantileType7(sorted, alpha2), z0, a: ahat, alpha1, alpha2 };
}

function statUndefinedWhy(stat: BootStat): string {
  if (stat === "ratio") return "a resampled x̄ of 0";
  if (stat === "corr") return "a resample with a constant column";
  return "a resample with a constant x";
}
