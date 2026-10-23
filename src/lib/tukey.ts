// Tukey HSD — the post-hoc test ANOVA needs to be usable.
//
// WHY THIS MATTERS, and why it is a correctness issue rather than a convenience:
// a significant ANOVA says only "these groups are not all the same". It does not
// say WHICH differ. Without a post-hoc test the user reaches for repeated t-tests,
// and that inflates the false-positive rate: with 5 groups there are 10 pairs, and
// at alpha 0.05 per test the chance of at least one spurious "significant" result
// is 1 - 0.95^10 = 40%. Tukey holds the FAMILY-WISE rate at alpha instead.
//
// The hard part is the studentized range distribution q(k, df), which has no closed
// form. It is computed here by nested numerical integration:
//
//   P(Q <= q) = INTEGRAL_0^inf  f_df(s) * W_k(q*s) ds
//   W_k(w)    = k * INTEGRAL_-inf^inf  phi(z) * [Phi(z) - Phi(z-w)]^(k-1) dz
//
// where f_df is the density of s = sqrt(chi2_df / df) and W_k is the CDF of the
// range of k independent standard normals.
//
// HOW IT IS VERIFIED. Rather than trusting a transcribed q table — the failure mode
// this project keeps hitting — the implementation is checked against an EXACT
// IDENTITY: for two groups the studentized range is exactly sqrt(2) times the
// two-tailed t critical value,
//
//   q(alpha, 2, df) = sqrt(2) * t(alpha/2, df)
//
// That is a theorem, not a table lookup, and it is checked against the t
// distribution already in stats.ts. If the quadrature were wrong, it would not hold
// across df.
//
// Pure numerics — no Office.js.

import { normalCdf } from "./stats2";
import { tCritical } from "./stats";

/** Standard normal PDF. */
function phi(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * CDF of the RANGE of k independent standard normals, evaluated at w.
 *
 * W_k(w) = k * INTEGRAL phi(z) [Phi(z) - Phi(z-w)]^(k-1) dz
 *
 * Reads as: the smallest observation sits at z (density phi(z), k ways to choose
 * which one), and every other observation lies within w above it.
 */
function rangeCdf(w: number, k: number): number {
  if (w <= 0) return 0;
  // phi(z) < 1e-9 beyond |z| = 6, so a wider window buys nothing but time. These
  // resolutions were tuned DOWN from [-8.5, 8.5]/N=480 while watching the
  // q(alpha,2,df) = sqrt(2)*t(alpha/2,df) identity hold — having a real check makes
  // it safe to optimise, because a resolution that is too coarse breaks the theorem
  // immediately instead of silently degrading.
  const LO = -6.5;
  const HI = 6.5;
  const N = 140; // even, for Simpson
  const h = (HI - LO) / N;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const z = LO + i * h;
    const inner = normalCdf(z) - normalCdf(z - w);
    const f = phi(z) * Math.pow(Math.max(inner, 0), k - 1);
    const weight = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
    sum += weight * f;
  }
  return Math.min(1, Math.max(0, (k * sum * h) / 3));
}

/** ln Γ(x) — Lanczos. Needed for the chi density's normalising constant. */
function lnGamma(x: number): number {
  const g = 7;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = C[0];
  for (let i = 1; i < g + 2; i++) a += C[i] / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Density of s = sqrt(chi2_df / df), the ANOVA's pooled standard-error scale. */
function sDensity(s: number, df: number): number {
  if (s <= 0) return 0;
  const lnC = (df / 2) * Math.log(df) - lnGamma(df / 2) - (df / 2 - 1) * Math.LN2;
  return Math.exp(lnC + (df - 1) * Math.log(s) - (df * s * s) / 2);
}

/**
 * CDF of the studentized range: P(Q <= q) for k groups and df error degrees of
 * freedom.
 */
export function studentizedRangeCdf(q: number, k: number, df: number): number {
  if (q <= 0) return 0;
  if (!(k >= 2) || !(df >= 1)) return NaN;
  // Large df: s concentrates at 1 and the outer integral stops earning its cost.
  // Checked against the sqrt(2)*t identity now that the quadrature below is
  // right: the df -> infinity limit is within 0.06% at df = 2000 and 0.02% at
  // 5000, against a quadrature that costs ~700 ms per uncached call versus 7 ms
  // for the limit. The threshold used to be 5000, which made a visible SEAM
  // (0.92 against 0.84 either side of it) — but that was the broken quadrature
  // below the seam, not the limit above it.
  if (df > 2000) return rangeCdf(q, k);

  // THE INTEGRATION WINDOW HAS TO FOLLOW THE PEAK, AND THE NODE COUNT HAS TO
  // FOLLOW ITS WIDTH.
  //
  // The s-density is concentrated at s = 1 with standard deviation about
  // 1/sqrt(2*df). The previous version pinned the lower limit at 1e-6 and moved
  // only the upper one, so for large df the interval stayed roughly [0, 1.2]
  // while the peak shrank to a width of ~0.01 — with a fixed 72 nodes, the entire
  // peak was straddled by ABOUT ONE NODE. Simpson's rule then returned whatever
  // the node alignment happened to sample, and the answer stopped being monotone
  // in df: the CDF at q = 3, k = 3 went 0.913 (df 1500), 0.897 (2500), 0.862
  // (3900), 0.998 (4900), around a true value near 0.914.
  //
  // The consequences were not subtle. Against this file's own stated anchor,
  // q(alpha, 2, df) = sqrt(2)*t(alpha/2, df), the critical value was 9.7% wrong at
  // df = 3000, 22.7% wrong at df = 4999, and at df = 4000 bisection ran into its
  // ceiling and returned 30 — after which nothing can ever be significant. At
  // alpha = 0.01 the error went the ANTI-CONSERVATIVE way, 19% low, which
  // manufactures false positives instead of hiding true ones.
  //
  // So: centre the window on the peak, keep the old generous reach at small df
  // where the density really is broad and skewed, and choose the node count so
  // the step is a fixed small fraction of the peak width rather than a fixed
  // number of nodes over a window that changes size.
  // The window scales with the peak so the STEP-TO-WIDTH ratio is constant, which
  // is what the old code got wrong — not the node count. A first attempt at this
  // fix also raised the node count to 20 per standard deviation; that was
  // correct to 1e-7 and took 3 to 4.5 SECONDS per uncached call, which in a pane
  // that recomputes on every keystroke is a frozen Word. Trading a wrong number
  // for a hang is the worse bargain, and this repo has shipped that bug before.
  //
  // 96 nodes over a window of about 18 standard deviations puts the step at ~0.19
  // sigma at EVERY df, which Simpson resolves to better than 1e-4 relative — far
  // finer than a critical value means — at roughly the cost of the original.
  //
  // Below df = 20 the s-density is genuinely broad and right-skewed, so the old
  // generous reach is kept there rather than assuming near-Gaussian. At df = 1 the
  // density peaks at s = 0 rather than s = 1 and 96 nodes leave ~3% error there;
  // that is far better than the ~29% the old code gave, and df = 1 cannot be
  // reached from the pane anyway — k groups of at least 2 force df >= k >= 2. A
  // finer grid fixes it and costs seconds, which is not a trade worth making for
  // an unreachable case.
  const sigma = 1 / Math.sqrt(2 * df);
  const reach = df >= 20 ? 9 * sigma : 10 / Math.sqrt(df);
  const LO = Math.max(1e-9, 1 - reach);
  const HI = 1 + reach;
  const N = 96;
  const h = (HI - LO) / N;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const s = LO + i * h;
    const f = sDensity(s, df) * rangeCdf(q * s, k);
    const weight = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
    sum += weight * f;
  }
  return Math.min(1, Math.max(0, (sum * h) / 3));
}

/** Upper-tail p for an observed studentized range. */
export function studentizedRangeP(q: number, k: number, df: number): number {
  // At small df the quadrature above misreads the upper tail: at df = 2 it gave p = 0.00032 where the true value is
  // 0.00125 (scipy; release A review), and it is still off at df 3 to 5 — at df 3, k 3, q 20 it gives 0.0016709
  // against scipy's 0.0015753. Measured worst relative tail error: 1.2e-1 at df 3, 1.2e-2 at df 4, 1.1e-3 at df 5,
  // 1.5e-4 at df 6. So below SMALL_DF the fractional-df integral answers, here AND in studentizedRangeCritical,
  // so that "significant" (q against the critical value) and p < alpha can never disagree.
  if (df < SMALL_DF) {
    const s = studentizedRangeSf(q, k, df);
    if (Number.isFinite(s)) return Math.min(1, Math.max(0, s));
  }
  const p = 1 - studentizedRangeCdf(q, k, df);
  return Math.min(1, Math.max(0, p));
}

/**
 * Critical value q(alpha, k, df) — the studentized range exceeded with probability
 * alpha. Found by bisection on the CDF, which is monotone in q.
 */
export function studentizedRangeCritical(alpha: number, k: number, df: number): number {
  if (!(alpha > 0 && alpha < 1) || !(k >= 2) || !(df >= 1)) return NaN;
  const key = `${alpha}|${k}|${df}`;
  const hit = CRIT_CACHE.get(key);
  if (hit !== undefined) return hit;
  // Same switch as studentizedRangeP, for the same reason: with the old tail at
  // df 2, tukeyHSD([[0, 1], [7.015, 8.015]], 0.01) called the pair significant
  // (q = 14.03 above a critical value read too low) beside p = 0.010008.
  if (df < SMALL_DF && Number.isInteger(k)) {
    const qq = studentizedRangeQuantile(alpha, k, df);
    if (Number.isFinite(qq)) {
      CRIT_CACHE.set(key, qq);
      return qq;
    }
  }
  let lo = 0;
  let hi = 30;
  // 28 steps on [0,30] resolves ~1e-7. The original 60 resolved 3e-17 -- past double
  // precision, and past any meaning a critical value has.
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (studentizedRangeCdf(mid, k, df) < 1 - alpha) lo = mid;
    else hi = mid;
  }
  const q = (lo + hi) / 2;
  CRIT_CACHE.set(key, q);
  return q;
}

/**
 * Critical values are pure functions of (alpha, k, df) and each costs a nested
 * quadrature, so they are memoised. Without this a single Tukey call recomputed the
 * same q for every pair and the pane froze: one critical value took 10.5 SECONDS.
 */
const CRIT_CACHE = new Map<string, number>();

/** Below this df, P and the critical value come from the fractional-df tail integral. */
const SMALL_DF = 6;

/**
 * A bounded least-recently-used cache: a hit moves the key to the back of the
 * Map's insertion order, and an insert past `cap` evicts the front (oldest).
 *
 * WHY NOT CLEAR-ALL. The quantile cache used to be cleared wholesale past 400
 * entries; Games–Howell at k = 20 has 190 pairs, each with its own df, at
 * three alphas the pane may ask for, so editing one group recomputed the whole
 * set every few keystrokes (stalls of 1 to 1.7 s). An LRU keeps the pairs the
 * user is not editing.
 */
class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(readonly cap: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key: string, v: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.cap) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, v);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get size(): number {
    return this.map.size;
  }
}

/** Exported for the tests only. */
export const LruCacheForTest = LruCache;

// ===========================================================================
// The studentized range at FRACTIONAL and SMALL df — for Games–Howell.
// ===========================================================================
//
// WHY A SECOND PATH. Games–Howell gives every pair its own Welch–Satterthwaite
// df, which is fractional and can be as small as min(nᵢ − 1, nⱼ − 1) — that is,
// close to 1 for a pair of two-value groups with very different spreads. The
// path above was tuned for Tukey, where df ≥ k ≥ 2 is an integer and usually
// large, and measured against scipy.stats.studentized_range (1.18) it is not fit
// for that region: at df = 2, k = 2, q = 40 it returned p = 0.00032 against the
// true 0.00125; at df = 1.5, k = 5, q = 40, 0.0059 against 0.0129. Errors of
// that size flip "significant" in exactly the small-group, unequal-variance
// case Games–Howell exists for. The cause is the outer grid: the upper tail's
// mass sits at small s (s < ~8/q), where a 96-node grid over [0, 9] has one or
// two nodes.
//
// This path:
//   • integrates the UPPER TAIL directly, ∫ f(s)·(1 − W(q·s)) ds, rather than
//     1 − CDF, so a small p is not the difference of two numbers near 1;
//   • substitutes t = ln s, which turns the s-density's s^(df−1) cusp at zero
//     into a smooth exponential decay at every df, including fractional df < 2;
//   • integrates that adaptively (Gauss–Kronrod 7/15), so the nodes go where
//     the integrand changes rather than where a fixed grid happens to put them;
//   • uses a double-precision normal CDF for the range integral, because the
//     erf in stats2.ts (|error| < 1.2e-7) would put a floor under every p.
//
// The Tukey functions above keep their own quadrature at df ≥ 6, where their
// values are pinned across the product and agree with scipy; below df 6 both
// studentizedRangeP and studentizedRangeCritical hand over to this path.

// Math functions bound once at module scope. Inside jest's vm sandbox every
// `Math.x` in a hot loop is a slow global lookup (measured: Games–Howell on 12
// groups took 4.5 s under jest and 0.3 s in node); module constants cost nothing
// in either.
const { abs: mAbs, exp: mExp, min: mMin, max: mMax, pow: mPow, expm1: mExpm1, log1p: mLog1p } = Math;

/**
 * Standard normal CDF, Hart (1968) / West (2005) "Better approximations to
 * cumulative normal functions", algorithm 5666 form. Against scipy.stats.norm.cdf
 * (welch.test.ts): relative error below 1e-10 for x ≥ −5 and absolute error
 * below 1e-19 in the far tail, against 1.2e-7 absolute for the erf in stats2.ts.
 */
function normalCdfFine(x: number): number {
  const a = mAbs(x);
  let c: number;
  if (a > 37) c = 0;
  else {
    const e = mExp(-0.5 * a * a);
    if (a < 7.07106781186547) {
      let num = 3.52624965998911e-2 * a + 0.700383064443688;
      num = num * a + 6.37396220353165;
      num = num * a + 33.912866078383;
      num = num * a + 112.079291497871;
      num = num * a + 221.213596169931;
      num = num * a + 220.206867912376;
      let den = 8.83883476483184e-2 * a + 1.75566716318264;
      den = den * a + 16.064177579207;
      den = den * a + 86.7807322029461;
      den = den * a + 296.564248779674;
      den = den * a + 637.333633378831;
      den = den * a + 793.826512519948;
      den = den * a + 440.413735824752;
      c = (e * num) / den;
    } else {
      let b = a + 0.65;
      b = a + 4 / b;
      b = a + 3 / b;
      b = a + 2 / b;
      b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Exported for the tests only: the precise Φ, checked against scipy. */
export const normalCdfFineForTest = normalCdfFine;

/** Gauss-Legendre nodes/weights on [-1, 1] by Newton on P_n (as dunnett.ts). */
function gaussLegendreNodes(n: number): { x: number[]; w: number[] } {
  const x = new Array<number>(n);
  const w = new Array<number>(n);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (mAbs(dz) < 1e-15) break;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
    w[n - 1 - i] = w[i];
  }
  return { x, w };
}

/**
 * The z grid for the range integral, built once: Gauss–Legendre panels over
 * [−8.5, 8.5] (φ(8.5) ≈ 2e-16), with Φ(z)·φ(z) precomputed at each node so a
 * W evaluation costs one Φ per node.
 */
interface RangeGrid {
  z: number[];
  wPhi: number[];
  /** 1 − Φ(z) at each node, computed as Φ(−z) so it keeps relative precision. */
  upper: number[];
}
let rangeGridCache: RangeGrid | null = null;
function rangeGrid(): RangeGrid {
  if (rangeGridCache) return rangeGridCache;
  const { x, w } = gaussLegendreNodes(RANGE_GL_N);
  const z: number[] = [];
  const wPhi: number[] = [];
  const upper: number[] = [];
  for (let e = 0; e + 1 < RANGE_EDGES.length; e++) {
    const mid = (RANGE_EDGES[e] + RANGE_EDGES[e + 1]) / 2;
    const half = (RANGE_EDGES[e + 1] - RANGE_EDGES[e]) / 2;
    for (let i = 0; i < x.length; i++) {
      const zz = mid + half * x[i];
      z.push(zz);
      wPhi.push(w[i] * half * phi(zz));
      upper.push(normalCdfFine(-zz));
    }
  }
  rangeGridCache = { z, wPhi, upper };
  return rangeGridCache;
}
const RANGE_GL_N = 12;
const RANGE_EDGES = [-8.5, -4.5, -2, 0, 2, 4.5, 8.5];

/**
 * 1 − W_k(w): the chance the range of k independent standard normals EXCEEDS w,
 * written so it is computed directly rather than as 1 − W:
 *
 *   1 − W_k(w) = k ∫ φ(z) { [1 − Φ(z)]^(k−1) − [Φ(z+w) − Φ(z)]^(k−1) } dz
 *
 * (the smallest observation at z; the others either all lie above z, or all
 * lie within w above it). With a = 1 − Φ(z) and b = Φ(z+w) − Φ(z) = a − c,
 * c = 1 − Φ(z+w), the difference a^m − b^m is a^m·(1 − (1 − c/a)^m), which
 * keeps its relative precision when w is large and the difference is tiny.
 */
function rangeSf(w: number, k: number): number {
  if (!(w > 0)) return 1;
  const g = rangeGrid();
  const m = k - 1;
  let sum = 0;
  for (let i = 0; i < g.z.length; i++) {
    const z = g.z[i];
    const a = g.upper[i]; // 1 − Φ(z), precomputed as Φ(−z)
    if (a <= 0) continue;
    const c = normalCdfFine(-(z + w)); // 1 − Φ(z + w), computed as a lower tail
    // a^m − b^m with b = a − c, written as a^m · (1 − (1 − c/a)^m) and evaluated
    // through log1p/expm1: no cancellation when c ≪ a (large w, the tail that
    // matters), and O(1) per node rather than a sum of m terms.
    const r = mMin(1, c / a);
    const diff = m === 1 ? c : r >= 1 ? mPow(a, m) : mPow(a, m) * -mExpm1(m * mLog1p(-r));
    sum += g.wPhi[i] * diff;
  }
  return mMin(1, mMax(0, k * sum));
}

// Gauss–Kronrod 7/15 on [-1, 1]: Kronrod nodes (non-negative half) and
// weights, and the embedded 7-point Gauss weights for the odd-indexed nodes.
// The tests check K15 integrates x²² exactly (and not x²⁴) and G7 x¹² exactly
// (and not x²⁰), which a mistyped digit could not survive.
const GK_X = [
  0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440,
  0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0,
];
const GK_WK = [
  0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919,
  0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828,
];
const GK_WG = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

/** One Gauss–Kronrod 15 panel: the K15 estimate and its |K15 − G7| error. */
function gk15(f: (x: number) => number, a: number, b: number): { v: number; err: number } {
  const mid = (a + b) / 2;
  const half = (b - a) / 2;
  const fc = f(mid);
  let k = GK_WK[7] * fc;
  let g = GK_WG[3] * fc;
  for (let i = 0; i < 7; i++) {
    const dx = half * GK_X[i];
    const f1 = f(mid - dx);
    const f2 = f(mid + dx);
    k += GK_WK[i] * (f1 + f2);
    if (i % 2 === 1) g += GK_WG[(i - 1) / 2] * (f1 + f2);
  }
  return { v: k * half, err: mAbs((k - g) * half) };
}

/** Exported for the tests only: the GK15 panel, checked for polynomial exactness. */
export const gk15ForTest = gk15;

/**
 * Adaptive Gauss–Kronrod: split the panel with the largest error estimate until
 * the total estimated error is below max(absTol, relTol·|total|). Bounded: at
 * most `maxPanels` panels, so a pathological integrand costs a fixed amount of
 * time instead of freezing Word.
 */
function adaptiveGK(f: (x: number) => number, a: number, b: number, absTol: number, relTol: number, maxPanels = 120): number {
  const panels: { a: number; b: number; v: number; err: number }[] = [];
  // Start from a few panels so a narrow feature is not missed by one K15.
  const start = 4;
  for (let i = 0; i < start; i++) {
    const lo = a + ((b - a) * i) / start;
    const hi = a + ((b - a) * (i + 1)) / start;
    panels.push({ a: lo, b: hi, ...gk15(f, lo, hi) });
  }
  for (;;) {
    let total = 0;
    let errSum = 0;
    let worst = 0;
    for (let i = 0; i < panels.length; i++) {
      total += panels[i].v;
      errSum += panels[i].err;
      if (panels[i].err > panels[worst].err) worst = i;
    }
    if (errSum <= mMax(absTol, relTol * mAbs(total)) || panels.length >= maxPanels) return total;
    const p = panels[worst];
    const m = (p.a + p.b) / 2;
    panels.splice(worst, 1, { a: p.a, b: m, ...gk15(f, p.a, m) }, { a: m, b: p.b, ...gk15(f, m, p.b) });
  }
}

/**
 * Upper tail P(Q > q) of the studentized range with k means and df degrees of
 * freedom, accurate at FRACTIONAL and small df (df ≥ 1). NaN for k < 2, df < 1
 * or a non-finite q — callers refuse before reaching it.
 */
export function studentizedRangeSf(q: number, k: number, df: number): number {
  if (!Number.isFinite(q) || !Number.isInteger(k) || k < 2 || !(df >= 1) || !Number.isFinite(df)) return NaN;
  if (q <= 0) return 1;
  const key = `${q}|${k}|${df}`;
  const hit = SF_CACHE.get(key);
  if (hit !== undefined) return hit;
  const p = studentizedRangeSfUncached(q, k, df);
  SF_CACHE.set(key, p);
  return p;
}

/** The tail integral is a pure function of (q, k, df) and costs one adaptive quadrature. */
const SF_CACHE = new LruCache<number>(4096);

function studentizedRangeSfUncached(q: number, k: number, df: number): number {
  // df → ∞: s is exactly 1 and the tail is the normal range's. The integral
  // below stays exact to df = 1e8 (checked against the k = 2 t identity); the
  // limit is only for df beyond any Welch–Satterthwaite df a real data set gives.
  if (df > 1e9) return rangeSf(q, k);

  // t = ln s. The density of t is g(t) = exp(lnC + df·t − df·e^(2t)/2), with
  // lnC the normalising constant of s = √(χ²_df / df). Its peak is at t = 0.
  const lnC = (df / 2) * Math.log(df) - lnGamma(df / 2) - (df / 2 - 1) * Math.LN2;
  // expm1, not exp − 1: near the peak at large df, t is ~1e-4 and exp(2t) − 1
  // would lose half its digits.
  const L = (t: number): number => df * (t - mExpm1(2 * t) / 2); // ln g(t) − ln g(0)
  // The window: where g has fallen by e^(−42) (~6e-19) of its peak on each side.
  const DROP = -42;
  let lo = -1;
  while (L(lo) > DROP) lo *= 2;
  let a0 = lo;
  let b0 = 0;
  for (let i = 0; i < 80; i++) {
    const m = (a0 + b0) / 2;
    if (L(m) > DROP) b0 = m;
    else a0 = m;
  }
  const tLo = a0;
  let hi = 1;
  while (L(hi) > DROP) hi *= 2;
  a0 = 0;
  b0 = hi;
  for (let i = 0; i < 80; i++) {
    const m = (a0 + b0) / 2;
    if (L(m) > DROP) a0 = m;
    else b0 = m;
  }
  const tHi = b0;
  const lnG0 = lnC - df / 2;
  const integrand = (t: number): number => {
    const dens = mExp(lnG0 + L(t));
    if (dens === 0) return 0;
    return dens * rangeSf(q * mExp(t), k);
  };
  const p = adaptiveGK(integrand, tLo, tHi, 1e-11, 1e-7);
  return mMin(1, mMax(0, p));
}

/**
 * Critical value: the q with P(Q > q) = alpha, for fractional df. Brent's
 * method on ln P(Q > q) − ln alpha, bracketed from below by the exact k = 2
 * value √2·t(alpha/2, df) (the range of k ≥ 2 means is at least the range of
 * two). Memoised in a bounded cache.
 */
export function studentizedRangeQuantile(alpha: number, k: number, df: number): number {
  if (!(alpha > 0 && alpha < 1) || !Number.isInteger(k) || k < 2 || !(df >= 1) || !Number.isFinite(df)) return NaN;
  const key = `${alpha}|${k}|${df}`;
  const hit = QUANTILE_CACHE.get(key);
  if (hit !== undefined) return hit;
  const f = (q: number): number => Math.log(studentizedRangeSf(q, k, df)) - Math.log(alpha);
  // Bracket from both sides with the t distribution, which is cheap:
  //   below: √2·t(α/2; df), the exact k = 2 value — k ≥ 2 means can only have a
  //          wider range than two;
  //   above: √2·t(α/(2m); df), m = k(k−1)/2 — Bonferroni over the m pairs,
  //          which is conservative for the studentized range.
  // The root lies between, usually close to the upper end, so Brent needs a
  // handful of tail integrals instead of the ~10 a blind bracket cost.
  const m = (k * (k - 1)) / 2;
  let a = Math.SQRT2 * tCritical(alpha, df);
  let fa = f(a);
  let guard = 0;
  while (!(fa > 0) && guard++ < 60) {
    if (k === 2 && Math.abs(fa) < 1e-9) break; // k = 2: the t value IS the answer
    a *= 0.8;
    fa = f(a);
  }
  if (k === 2 && Math.abs(fa) < 1e-9) {
    QUANTILE_CACHE.set(key, a);
    return a;
  }
  let b = Math.SQRT2 * tCritical(alpha / m, df);
  if (!(b > a)) b = a * 1.5;
  let fb = f(b);
  guard = 0;
  while (fb > 0 && guard++ < 60) {
    a = b;
    fa = fb;
    b *= 1.6;
    fb = f(b);
  }
  if (!(fa > 0 && fb <= 0)) return NaN;
  const q = brent(f, a, b, fa, fb, 1e-8);
  QUANTILE_CACHE.set(key, q);
  return q;
}
const QUANTILE_CACHE = new LruCache<number>(4096);

/** Exported for the tests only: is this (alpha, k, df) quantile cached? */
function quantileCached(alpha: number, k: number, df: number): boolean {
  return QUANTILE_CACHE.has(`${alpha}|${k}|${df}`);
}
export const quantileCachedForTest = quantileCached;

/** Brent's root finder on [a, b] with f(a), f(b) of opposite sign. */
function brent(f: (x: number) => number, a: number, b: number, fa: number, fb: number, relTol: number): number {
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let iter = 0; iter < 100; iter++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol = 2 * Number.EPSILON * Math.abs(b) + 0.5 * relTol * Math.abs(b);
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      let p: number;
      let qq: number;
      const s = fb / fa;
      if (a === c) {
        p = 2 * m * s;
        qq = 1 - s;
      } else {
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * m * t * (t - r) - (b - a) * (r - 1));
        qq = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) qq = -qq;
      else p = -p;
      if (2 * p < Math.min(3 * m * qq - Math.abs(tol * qq), Math.abs(e * qq))) {
        e = d;
        d = p / qq;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
  }
  return b;
}

export interface TukeyPair {
  /** 0-based group indices, i < j. */
  i: number;
  j: number;
  meanI: number;
  meanJ: number;
  /** meanI - meanJ. */
  difference: number;
  /** The studentized range statistic for this pair. */
  q: number;
  /** Family-wise adjusted p — already corrected for all pairs. */
  p: number;
  /** Confidence interval on the difference, at the family-wise level. */
  ciLow: number;
  ciHigh: number;
  significant: boolean;
}

export interface TukeyResult {
  pairs: TukeyPair[];
  /** Mean square error from the ANOVA — the pooled within-group variance. */
  mse: number;
  dfWithin: number;
  /** Number of groups. */
  k: number;
  alpha: number;
  /** q(alpha, k, dfWithin) — the threshold every pair is compared against. */
  qCritical: number;
  caveats: string[];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Tukey HSD (Tukey-Kramer for unequal n) across k groups.
 *
 * The p values are FAMILY-WISE: they already account for every pairwise comparison,
 * so they need no further Bonferroni correction. Applying one on top would be
 * double-counting and would make the test needlessly conservative.
 */
/**
 * The most groups the pane runs Tukey HSD on, the same limit Games–Howell and Welch's ANOVA carry (welch.ts
 * WELCH_MAX_GROUPS). Release D measured the recompute per keystroke in the production bundle on ~2000 values:
 * 20 groups 0.5 s, 50 groups 4.0 s, 500 groups 31.8 s (a frozen Word). Every pair needs its own studentized-range
 * probability.
 */
export const TUKEY_MAX_GROUPS = 20;

/** The pane's refusal above TUKEY_MAX_GROUPS, or null. */
export function tukeyGroupLimit(k: number): string | null {
  if (!(k > TUKEY_MAX_GROUPS)) return null;
  return (
    `Tukey HSD is limited to ${TUKEY_MAX_GROUPS} groups here (${k} were entered). ` +
    `Each of the ${(k * (k - 1)) / 2} pairs needs its own studentized-range probability, ` +
    "and beyond this the pane would stall while you type."
  );
}

export function tukeyHSD(groups: number[][], alpha = 0.05): TukeyResult | null {
  const k = groups.length;
  if (k < 2) return null;
  if (groups.some((g) => g.length < 1)) return null;

  const n = groups.map((g) => g.length);
  const means = groups.map(mean);
  const total = n.reduce((a, b) => a + b, 0);
  const dfWithin = total - k;
  if (dfWithin < 1) return null;

  // Pooled within-group variance — the same MSE the ANOVA uses.
  let ssWithin = 0;
  for (let g = 0; g < k; g++) {
    const m = means[g];
    for (const x of groups[g]) ssWithin += (x - m) * (x - m);
  }
  const mse = ssWithin / dfWithin;
  const qCritical = studentizedRangeCritical(alpha, k, dfWithin);

  const pairs: TukeyPair[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      // Tukey-Kramer standard error: handles unequal group sizes, and reduces to
      // the equal-n Tukey form when n_i = n_j.
      const se = Math.sqrt((mse / 2) * (1 / n[i] + 1 / n[j]));
      const difference = means[i] - means[j];
      const q = se > 0 ? Math.abs(difference) / se : Infinity;
      const margin = qCritical * se;
      pairs.push({
        i, j,
        meanI: means[i],
        meanJ: means[j],
        difference,
        q,
        p: studentizedRangeP(q, k, dfWithin),
        ciLow: difference - margin,
        ciHigh: difference + margin,
        significant: q > qCritical,
      });
    }
  }

  const caveats: string[] = [
    `p values are FAMILY-WISE across all ${pairs.length} pairwise comparison${pairs.length === 1 ? "" : "s"} — ` +
      "they already account for multiplicity. Do NOT apply a Bonferroni correction on top; " +
      "that would double-count and make the test needlessly conservative.",
    "Assumes the ANOVA's assumptions: independent observations, roughly normal residuals, " +
      "and equal variances across groups. Tukey is fairly robust to non-normality but NOT " +
      "to unequal variances. Run \"Check test assumptions\" (Stats) to find out whether "
      + "yours are equal; if they are not, use Games–Howell (Stats) instead: it keeps each "
      + "group's own variance. A rank test such as Kruskal-Wallis does not repair unequal variances.",
    "Tukey is for ALL pairwise comparisons. If you only ever intended to compare each group " +
      "against one control, Dunnett's test is more powerful; using Tukey there costs you " +
      "sensitivity for comparisons you never wanted. Dunnett is available in Stats.",
  ];
  if (mse === 0) {
    // Every observation within every group is identical, so the pooled variance is
    // zero and q is infinite for any pair whose means differ. That is arithmetically
    // honest and practically meaningless: real measurements have error. Found by the
    // adversarial pass, which reported q = Infinity — a value that would have
    // rendered in the pane as the literal word "Infinity".
    caveats.unshift(
      "ZERO within-group variance: every replicate in every group is identical. That gives " +
        "an infinite test statistic and a p of 0 for any pair whose means differ — arithmetic, " +
        "not evidence. Real measurements vary; data like this is usually rounded, duplicated, " +
        "or synthetic. Do not report these p values."
    );
  }
  if (new Set(n).size > 1) {
    caveats.push(
      "Group sizes are unequal, so this is the Tukey-Kramer variant. It is approximate " +
        "(slightly conservative) rather than exact, unlike the equal-n case."
    );
  }
  const small = n.filter((x) => x < 3).length;
  if (small) {
    caveats.push(`${small} group${small === 1 ? " has" : "s have"} fewer than 3 observations — the pooled variance, and therefore every interval here, rests on very little data.`);
  }

  return { pairs, mse, dfWithin, k, alpha, qCritical, caveats };
}
