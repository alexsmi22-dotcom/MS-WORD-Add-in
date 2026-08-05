// Dunnett's test — every treatment against ONE control.
//
// WHY THIS EXISTS
// Tukey's own caveat pointed here ("if you only ever intended to compare each
// group against one control, Dunnett's test is more powerful"), and the test did
// not exist. That is the same defect as the Games-Howell line it sits beside:
// naming a tool the product does not have.
//
// It matters beyond tidiness. Tukey corrects for ALL k(k−1)/2 pairwise
// comparisons. A dose-response study comparing 4 doses against vehicle wants 4
// comparisons, not 10, and paying the Tukey penalty for 6 comparisons nobody
// asked for costs real sensitivity — the difference is routinely one
// significant result versus none.
//
// HOW THE p-VALUE IS OBTAINED
// The k statistics are jointly multivariate-t, which has no closed form. But the
// correlation has a FACTOR structure: with n_i in treatment i and n_0 in the
// control,
//
//     rho_ij = lambda_i * lambda_j,   lambda_i = sqrt(n_i / (n_i + n_0))
//
// (balanced designs give the familiar rho = 1/2). A factor structure collapses
// the k-dimensional integral to a nested pair of one-dimensional ones, which is
// what makes this computable to full accuracy rather than approximated:
//
//   P(all |T_i| < t) = INT_0^inf f_S(s) INT_-inf^inf phi(u)
//                        PROD_i [ Phi((t*s - l_i*u)/sqrt(1-l_i^2))
//                               - Phi((-t*s - l_i*u)/sqrt(1-l_i^2)) ] du ds
//
// where S = sqrt(chi2_v / v) carries the pooled variance estimate.
//
// The correctness anchor is exact and cheap: with ONE treatment group there is
// nothing to correct for, so the adjusted p must equal the ordinary two-sided
// t-test p. The tests check that to 1e-6, which pins the whole integration.

import { mean, variance, tTestP } from "./stats";
import { normalCdf } from "./stats2";

/** log Γ(x) — Lanczos, matching the approximation used elsewhere in the project. */
function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const phi = (z: number): number => Math.exp(-0.5 * z * z) / SQRT_2PI;

/**
 * Gauss-Legendre nodes and weights on [-1, 1], by Newton iteration on P_n.
 *
 * Computed once per order and cached: the pane recomputes statistics on every
 * keystroke, and recomputing 48 Legendre roots each time would put the cost back
 * where it was.
 */
const glCache = new Map<number, { x: number[]; w: number[] }>();

function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const hit = glCache.get(n);
  if (hit) return hit;
  const x = new Array<number>(n);
  const w = new Array<number>(n);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    // Chebyshev starting guess, then Newton on the Legendre polynomial.
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let k = 0; k < n; k++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * k + 1) * z * p2 - k * p3) / (k + 1);
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
    w[n - 1 - i] = w[i];
  }
  const out = { x, w };
  glCache.set(n, out);
  return out;
}

/** Critical values keyed by design, not by data — see dunnettTest. */
const criticalCache = new Map<string, number>();

/** Quadrature order. 48 nodes is well past convergence for both integrands. */
const GL_N = 48;

export function dunnettProbability(
  t: number,
  lambdas: number[],
  df: number,
  twoSided = true,
): number {
  if (!Number.isFinite(df) || df <= 0) return NaN;
  if (!(t > 0)) return 0;

  const k = lambdas.length;
  const rest = new Array<number>(k);
  for (let i = 0; i < k; i++) rest[i] = Math.sqrt(Math.max(1e-12, 1 - lambdas[i] * lambdas[i]));

  const { x: gx, w: gw } = gaussLegendre(GL_N);

  // --- z grid: fixed window, weights folded together with the normal density ---
  const zLo = -8;
  const zHi = 8;
  const zMid = (zLo + zHi) / 2;
  const zHalf = (zHi - zLo) / 2;
  const zNode = new Array<number>(GL_N);
  const zWeight = new Array<number>(GL_N);
  for (let i = 0; i < GL_N; i++) {
    const z = zMid + zHalf * gx[i];
    zNode[i] = z;
    zWeight[i] = gw[i] * zHalf * phi(z);
  }

  // --- s grid: S = sqrt(chi2_df/df) concentrates near 1 with sd ~ 1/sqrt(2df) ---
  const logC = Math.log(2) - gammaln(df / 2) + (df / 2) * Math.log(df / 2);
  const sd = 1 / Math.sqrt(2 * df);
  const sLo = Math.max(1e-9, 1 - 10 * sd);
  const sHi = 1 + 10 * sd;
  const sMid = (sLo + sHi) / 2;
  const sHalf = (sHi - sLo) / 2;

  let total = 0;
  for (let a = 0; a < GL_N; a++) {
    const sv = sMid + sHalf * gx[a];
    if (sv <= 0) continue;
    const dens = Math.exp(logC + (df - 1) * Math.log(sv) - (df * sv * sv) / 2);
    if (dens === 0) continue;
    const ts = t * sv;

    let inner = 0;
    for (let b = 0; b < GL_N; b++) {
      const u = zNode[b];
      let prod = 1;
      for (let c = 0; c < k; c++) {
        const shift = lambdas[c] * u;
        const hi = normalCdf((ts - shift) / rest[c]);
        const lo = twoSided ? normalCdf((-ts - shift) / rest[c]) : 0;
        prod *= hi - lo;
        if (prod <= 0) {
          prod = 0;
          break;
        }
      }
      if (prod > 0) inner += zWeight[b] * prod;
    }
    total += gw[a] * sHalf * dens * inner;
  }

  return Math.min(1, Math.max(0, total));
}

export interface DunnettComparison {
  /** Index into the treatments array. */
  treatment: number;
  /** Treatment mean − control mean. */
  meanDifference: number;
  t: number;
  /** Family-wise adjusted p (single-step Dunnett). */
  p: number;
  significant: boolean;
  /**
   * The SIMULTANEOUS confidence interval on this difference — the interval
   * whose family-wise coverage is 1 − alpha across every treatment-vs-control
   * comparison at once, `diff ± critical × se`.
   *
   * Reported by the engine rather than reconstructed by a caller, because the
   * only way back to it from the numbers above is `se = diff / t`, which is
   * Infinity for a treatment whose mean happens to equal the control's — a
   * perfectly ordinary result, and the one where a chart would be drawn
   * infinitely wide.
   *
   * NOT the ordinary two-sample t interval: `critical` is Dunnett's own
   * multiplicity-corrected value, so this interval is WIDER, and it agrees with
   * the adjusted p beside it. Two intervals that disagreed about significance
   * in the same result would be worse than none.
   */
  ciLow: number;
  ciHigh: number;
}

export interface DunnettResult {
  ok: boolean;
  reason?: string;
  comparisons: DunnettComparison[];
  df: number;
  /** Pooled mean square error, from ALL groups including the control. */
  mse: number;
  /** Two-sided critical |t| at alpha. */
  critical: number;
  twoSided: boolean;
  controlN: number;
  caveats: string[];
}

/**
 * Dunnett's many-to-one comparison.
 *
 * The variance is pooled across every group including the control — the same
 * assumption one-way ANOVA makes, and the reason a control with few replicates
 * weakens every comparison at once.
 */
export function dunnettTest(
  control: number[],
  treatments: number[][],
  opts: { alpha?: number; twoSided?: boolean } = {},
): DunnettResult {
  const alpha = opts.alpha ?? 0.05;
  const twoSided = opts.twoSided !== false;
  const empty: DunnettResult = {
    ok: false,
    comparisons: [],
    df: NaN,
    mse: NaN,
    critical: NaN,
    twoSided,
    controlN: control?.length ?? 0,
    caveats: [],
  };

  const groups = treatments.filter((g) => g.length >= 1);
  if (!control || control.length < 2) {
    return { ...empty, reason: "The control group needs at least two values." };
  }
  if (groups.length < 1) {
    return { ...empty, reason: "Dunnett needs at least one treatment group to compare with the control." };
  }
  if (groups.some((g) => g.length < 2)) {
    return { ...empty, reason: "Each treatment group needs at least two values." };
  }

  // Pooled error variance across all groups (control included).
  const all = [control, ...groups];
  let ssWithin = 0;
  let dfWithin = 0;
  for (const g of all) {
    const v = variance(g);
    ssWithin += v * (g.length - 1);
    dfWithin += g.length - 1;
  }
  if (dfWithin <= 0) return { ...empty, reason: "Not enough replication to estimate the error variance." };
  const mse = ssWithin / dfWithin;
  if (!(mse > 0)) {
    return {
      ...empty,
      reason:
        "Every value within every group is identical, so there is no within-group variation " +
        "to test against and no t statistic exists.",
    };
  }

  const n0 = control.length;
  const m0 = mean(control);
  const lambdas = groups.map((g) => Math.sqrt(g.length / (g.length + n0)));

  const comparisons: DunnettComparison[] = groups.map((g, i) => {
    const diff = mean(g) - m0;
    const se = Math.sqrt(mse * (1 / g.length + 1 / n0));
    const t = diff / se;
    // Single-step adjusted p: the chance the LARGEST of the k statistics is at
    // least this extreme, which is what controls the family-wise error rate.
    const p = 1 - dunnettProbability(Math.abs(t), lambdas, dfWithin, twoSided);
    return {
      treatment: i,
      meanDifference: diff,
      t,
      p: Math.min(1, Math.max(0, p)),
      significant: p < alpha,
      // Filled in below, once the critical value is known: it depends on the
      // whole family, not on this comparison.
      se,
      ciLow: NaN,
      ciHigh: NaN,
    };
  });

  // Critical value by bisection on the same probability function.
  //
  // Cached on (lambdas, df, alpha, sidedness) because it depends only on the
  // GROUP SIZES, never on the values in them. The Stats pane recomputes on every
  // keystroke, and while typing, sizes change rarely and values constantly — so
  // this turns the most expensive part of the test into a one-off.
  const key = `${lambdas.map((l) => l.toFixed(6)).join(",")}|${dfWithin}|${alpha}|${twoSided}`;
  let critical = criticalCache.get(key);
  if (critical === undefined) {
    let lo = 0.1;
    let hi = 12;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (1 - dunnettProbability(mid, lambdas, dfWithin, twoSided) > alpha) lo = mid;
      else hi = mid;
    }
    critical = (lo + hi) / 2;
    // Bounded so a long session cannot grow it without limit.
    if (criticalCache.size > 200) criticalCache.clear();
    criticalCache.set(key, critical);
  }

  // The simultaneous intervals, now that the family-wide critical value exists.
  // `se` was carried on each comparison only to get here and is dropped again,
  // so the published shape stays the interval rather than the ingredients.
  for (const c of comparisons as (DunnettComparison & { se?: number })[]) {
    const se = c.se ?? NaN;
    c.ciLow = c.meanDifference - critical * se;
    c.ciHigh = c.meanDifference + critical * se;
    delete c.se;
  }

  const caveats = [
    `p values are FAMILY-WISE across the ${groups.length} treatment-vs-control ` +
      "comparison" +
      (groups.length === 1 ? "" : "s") +
      " — they already account for multiplicity. Do NOT apply a further Bonferroni correction.",
    "Dunnett compares each treatment with the CONTROL only. It says nothing about whether the " +
      "treatments differ from each other; for that, use Tukey HSD.",
    "Assumes the ANOVA's assumptions: independent observations, roughly normal residuals, and " +
      "equal variances across groups. Run “Check test assumptions” to test the last two.",
  ];
  if (twoSided) {
    caveats.push(
      "Two-sided: a treatment counts as different whether it is higher or lower than the control. " +
        "The one-sided form is more powerful but only valid if the direction was fixed BEFORE seeing the data.",
    );
  }

  return {
    ok: true,
    comparisons,
    df: dfWithin,
    mse,
    critical,
    twoSided,
    controlN: n0,
    caveats,
  };
}

/** Sanity anchor used by the tests, exported so the reduction is checkable. */
export function singleComparisonP(t: number, df: number): number {
  return tTestP(Math.abs(t), df);
}
