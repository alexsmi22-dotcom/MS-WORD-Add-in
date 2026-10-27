/**
 * Yield curves (release F1, gap item #16): a zero-curve bootstrap from par yields or coupon-bond prices with
 * discount factors and forward rates, and Nelson–Siegel / Svensson fits to (maturity, yield) points. Pure: no DOM.
 *
 * BOOTSTRAP CONVENTIONS (printed with every result):
 *   - Instruments sit on a grid of whole coupon periods (maturities that are multiples of 1/f years, f = 1 or 2),
 *     priced on a coupon date: no accrued interest. A par yield is a bond priced at 100 with that coupon.
 *   - Time is in years on that grid (no calendar); coupon k of a bond is paid at k/f years.
 *   - Interpolation: LINEAR IN THE CONTINUOUSLY COMPOUNDED ZERO RATE between knots, FLAT before the first knot
 *     (QuantLib's PiecewiseLinearZero does the same). A knot past a gap is solved by bisection so the bond whose
 *     intermediate coupons sit on the interpolated segment prices exactly.
 *   - Discount factor D(t) = e^(−z(t)·t). Periodic zero rate f·(D^(−1/(f·t)) − 1). Forward between consecutive knots:
 *     continuous (z₂t₂ − z₁t₁)/(t₂ − t₁), periodic f·((D₁/D₂)^(1/(f·(t₂ − t₁))) − 1).
 *
 * NELSON–SIEGEL: y(τ) = β₀ + β₁·L₁(τ/λ) + β₂·L₂(τ/λ), L₁(x) = (1 − e^(−x))/x, L₂(x) = L₁(x) − e^(−x); Svensson adds
 * β₃·L₂(τ/λ₂). The β are linear given λ, so the fit profiles λ over a bounded log grid (λ in [0.05, 50] years), solves
 * the β by least squares (Householder QR) at each grid point, and refines λ by golden section in log λ (bounded
 * iterations). Svensson profiles (λ₁, λ₂) on a 2-D grid with λ₂ ≥ 2·λ₁ (the two humps kept apart; otherwise the
 * two L₂ columns coincide and the fit is not identified), then refines by alternating golden sections.
 */

import { nelderMead } from "./optimize";

export type Refusal = { error: string };
const refuse = (error: string): Refusal => ({ error });

export const MAX_CURVE_KNOTS = 100;
export const MAX_CURVE_YEARS = 100;
export const MAX_FIT_POINTS = 200;

export interface CurveInstrument {
  /** Maturity in years (a multiple of 1/f). */
  t: number;
  /** Annual coupon rate, decimal. */
  coupon: number;
  /** Clean = dirty price per 100 (priced on a coupon date). */
  price: number;
}

export interface CurveKnot {
  t: number;
  /** Continuously compounded zero rate. */
  z: number;
  df: number;
  /** Periodic (f per year) zero rate. */
  zPeriodic: number;
  /** Forward from the previous knot (or from 0), continuous. */
  fwd: number;
  /** Forward from the previous knot, compounded f per year. */
  fwdPeriodic: number;
}

/** z(s) from knots (t ascending): flat before the first, linear in z between, flat after the last. */
export function zeroAt(ts: number[], zs: number[], s: number): number {
  if (!ts.length) return NaN;
  if (s <= ts[0]) return zs[0];
  for (let i = 1; i < ts.length; i++) {
    if (s <= ts[i]) return zs[i - 1] + ((zs[i] - zs[i - 1]) * (s - ts[i - 1])) / (ts[i] - ts[i - 1]);
  }
  return zs[zs.length - 1];
}

const onGrid = (t: number, f: number): boolean => Math.abs(t * f - Math.round(t * f)) <= 1e-9;

/** Bootstraps the zero curve (see the header). Instruments in any order; maturities must differ. */
export function bootstrapZeroCurve(instruments: CurveInstrument[], f: number): { knots: CurveKnot[] } | Refusal {
  if (f !== 1 && f !== 2) return refuse("Coupons per year must be 1 or 2 for the bootstrap grid.");
  if (instruments.length < 1) return refuse("Enter at least one instrument.");
  if (instruments.length > MAX_CURVE_KNOTS) return refuse(`At most ${MAX_CURVE_KNOTS} instruments.`);
  const ins = [...instruments].sort((a, b) => a.t - b.t);
  for (let i = 0; i < ins.length; i++) {
    const x = ins[i];
    if (!Number.isFinite(x.t) || x.t <= 0 || x.t > MAX_CURVE_YEARS) return refuse(`Maturity ${fmt(x.t)} years: maturities must be above 0 and at most ${MAX_CURVE_YEARS} years.`);
    if (!onGrid(x.t, f)) return refuse(`Maturity ${fmt(x.t)} years is not a whole number of ${f === 2 ? "half-years" : "years"}; the bootstrap prices on a grid of coupon dates (no accrued interest).`);
    if (!Number.isFinite(x.coupon) || x.coupon < -0.5 || x.coupon > 1) return refuse(`Coupon or par yield at ${fmt(x.t)} years must be between −50% and 100%.`);
    if (!Number.isFinite(x.price) || x.price <= 0 || x.price > 10000) return refuse(`Price at ${fmt(x.t)} years must be a positive number up to 10,000 (per 100).`);
    if (i > 0 && Math.abs(x.t - ins[i - 1].t) <= 1e-9) return refuse(`Two instruments mature at ${fmt(x.t)} years; give one per maturity.`);
  }
  const ts: number[] = [];
  const zs: number[] = [];
  for (const x of ins) {
    const m = Math.round(x.t * f);
    const c = (100 * x.coupon) / f;
    const tPrev = ts.length ? ts[ts.length - 1] : 0;
    const zPrev = zs.length ? zs[zs.length - 1] : NaN;
    // Coupons on or before the last knot are on the known curve: their value does not depend on the new knot.
    let known = 0;
    let kFirst = 1;
    if (ts.length) {
      while (kFirst <= m && kFirst / f <= tPrev + 1e-12) {
        const s = kFirst / f;
        known += (c + (kFirst === m ? 100 : 0)) * Math.exp(-zeroAt(ts, zs, s) * s);
        kFirst++;
      }
    }
    // Price of this bond if its own knot's zero rate is z (later coupons on the new segment, or flat before the first knot).
    const priceAt = (z: number): number => {
      let pv = known;
      for (let k = kFirst; k <= m; k++) {
        const s = k / f;
        const zz = ts.length ? zPrev + ((z - zPrev) * (s - tPrev)) / (x.t - tPrev) : z;
        pv += (c + (k === m ? 100 : 0)) * Math.exp(-zz * s);
      }
      return pv;
    };
    let lo = -0.5;
    let hi = 2;
    const gLo = priceAt(lo) - x.price;
    const gHi = priceAt(hi) - x.price;
    if (!(gLo >= 0 && gHi <= 0)) {
      return refuse(`No zero rate between −50% and 200% (continuous) prices the ${fmt(x.t)}-year instrument at ${fmt(x.price)}; check its coupon and price against the shorter maturities.`);
    }
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      if (priceAt(mid) - x.price > 0) lo = mid;
      else hi = mid;
    }
    ts.push(x.t);
    zs.push((lo + hi) / 2);
  }
  const knots: CurveKnot[] = ts.map((t, i) => {
    const z = zs[i];
    const df = Math.exp(-z * t);
    const t0 = i ? ts[i - 1] : 0;
    const df0 = i ? Math.exp(-zs[i - 1] * t0) : 1;
    const fwd = (z * t - (i ? zs[i - 1] * t0 : 0)) / (t - t0);
    return {
      t,
      z,
      df,
      zPeriodic: f * (Math.pow(df, -1 / (f * t)) - 1),
      fwd,
      fwdPeriodic: f * (Math.pow(df0 / df, 1 / (f * (t - t0))) - 1),
    };
  });
  return { knots };
}

// ------------------------------------------------------------------------------------------------------------------
// Nelson–Siegel and Svensson
// ------------------------------------------------------------------------------------------------------------------

export const NS_LAMBDA_MIN = 0.05;
export const NS_LAMBDA_MAX = 50;

function L1(x: number): number {
  if (x < 1e-8) return 1 - x / 2;
  return -Math.expm1(-x) / x;
}
function L2(x: number): number {
  if (x < 1e-8) return x / 2;
  return L1(x) - Math.exp(-x);
}

/** Model yield at τ for parameters β (3 or 4) and λ (1 or 2). */
export function nsYield(beta: number[], lambda: number[], tau: number): number {
  let y = beta[0] + beta[1] * L1(tau / lambda[0]) + beta[2] * L2(tau / lambda[0]);
  if (beta.length > 3) y += beta[3] * L2(tau / lambda[1]);
  return y;
}

/**
 * Least squares by Householder QR on columns (column-major, reused scratch): β and the residual sum of squares, or
 * null if rank-deficient. `cols` are overwritten.
 */
function lstsqCols(cols: Float64Array[], b: Float64Array): { beta: number[]; sse: number } | null {
  const p = cols.length;
  const n = b.length;
  const diag: number[] = [];
  for (let j = 0; j < p; j++) {
    const a = cols[j];
    let norm = 0;
    for (let i = j; i < n; i++) norm += a[i] * a[i];
    norm = Math.sqrt(norm);
    if (!(norm > 0)) return null;
    const alpha = a[j] > 0 ? -norm : norm;
    // v = a[j..] with v[j] = a[j] − alpha, kept in a[j..]; vv = |v|².
    const vj = a[j] - alpha;
    let vv = vj * vj;
    for (let i = j + 1; i < n; i++) vv += a[i] * a[i];
    a[j] = vj;
    if (vv > 0) {
      for (let k = j + 1; k < p; k++) {
        const c = cols[k];
        let s = 0;
        for (let i = j; i < n; i++) s += a[i] * c[i];
        const g = (2 * s) / vv;
        for (let i = j; i < n; i++) c[i] -= g * a[i];
      }
      let s = 0;
      for (let i = j; i < n; i++) s += a[i] * b[i];
      const g = (2 * s) / vv;
      for (let i = j; i < n; i++) b[i] -= g * a[i];
    }
    diag.push(alpha);
  }
  let dmax = 0;
  for (const v of diag) dmax = Math.max(dmax, Math.abs(v));
  for (const v of diag) if (!(Math.abs(v) > dmax * 1e-13)) return null;
  // R's off-diagonal entries R[j][k] (k > j) sit in cols[k][j]; its diagonal is diag[j].
  const beta = new Array(p).fill(0);
  for (let j = p - 1; j >= 0; j--) {
    let s = b[j];
    for (let k = j + 1; k < p; k++) s -= cols[k][j] * beta[k];
    beta[j] = s / diag[j];
  }
  let sse = 0;
  for (let i = p; i < n; i++) sse += b[i] * b[i];
  return { beta, sse };
}

function profile(ts: number[], ys: number[], lambda: number[]): { beta: number[]; sse: number } | null {
  const n = ts.length;
  const p = lambda.length > 1 ? 4 : 3;
  const cols: Float64Array[] = [];
  for (let j = 0; j < p; j++) cols.push(new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const x = ts[i] / lambda[0];
    cols[0][i] = 1;
    const l1 = L1(x);
    cols[1][i] = l1;
    cols[2][i] = x < 1e-8 ? x / 2 : l1 - Math.exp(-x);
    if (p === 4) cols[3][i] = L2(ts[i] / lambda[1]);
  }
  return lstsqCols(cols, Float64Array.from(ys));
}

export interface NsFit {
  model: "ns" | "svensson";
  beta: number[];
  lambda: number[];
  sse: number;
  rmse: number;
  r2: number;
  fitted: number[];
  /** λ ended on a search bound (the fit may want a λ outside [0.05, 50] years). */
  atBound: boolean;
}

const GOLD = (Math.sqrt(5) - 1) / 2;

/** Golden-section minimum of g on [a, b] (log-λ space), at most 200 steps. */
function golden(g: (u: number) => number, a: number, b: number): number {
  let c = b - GOLD * (b - a);
  let d = a + GOLD * (b - a);
  let gc = g(c);
  let gd = g(d);
  for (let i = 0; i < 200 && b - a > 1e-11; i++) {
    if (gc < gd) {
      b = d;
      d = c;
      gd = gc;
      c = b - GOLD * (b - a);
      gc = g(c);
    } else {
      a = c;
      c = d;
      gc = gd;
      d = a + GOLD * (b - a);
      gd = g(d);
    }
  }
  return (a + b) / 2;
}

/** Fits Nelson–Siegel or Svensson to (maturity in years, yield) points by profiled least squares (see the header). */
export function fitNelsonSiegel(ts: number[], ys: number[], model: "ns" | "svensson"): NsFit | Refusal {
  const n = ts.length;
  const need = model === "ns" ? 4 : 6;
  if (n !== ys.length) return refuse("Each curve point needs a maturity and a yield.");
  if (n < need) return refuse(`${model === "ns" ? "Nelson–Siegel" : "Svensson"} needs at least ${need} points (it has ${model === "ns" ? 4 : 6} parameters); ${n} given.`);
  if (n > MAX_FIT_POINTS) return refuse(`At most ${MAX_FIT_POINTS} curve points.`);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ts[i]) || ts[i] <= 0 || ts[i] > MAX_CURVE_YEARS) return refuse(`Row ${i + 1}: maturity must be above 0 and at most ${MAX_CURVE_YEARS} years.`);
    if (!Number.isFinite(ys[i]) || Math.abs(ys[i]) > 100) return refuse(`Row ${i + 1}: yield must be a number between −100% and 100%.`);
  }
  if (new Set(ts.map((t) => t.toPrecision(12))).size < (model === "ns" ? 3 : 4)) return refuse("The points need more distinct maturities to identify the curve's shape.");
  const lo = Math.log(NS_LAMBDA_MIN);
  const hi = Math.log(NS_LAMBDA_MAX);
  const sseAt = (lam: number[]): number => profile(ts, ys, lam)?.sse ?? Infinity;
  let best: number[];
  if (model === "ns") {
    const G = 200;
    let bi = -1;
    let bs = Infinity;
    for (let i = 0; i <= G; i++) {
      const s = sseAt([Math.exp(lo + ((hi - lo) * i) / G)]);
      if (s < bs) {
        bs = s;
        bi = i;
      }
    }
    if (bi < 0) return refuse("The curve points do not identify a Nelson–Siegel fit (the loadings are collinear at every λ).");
    const a = lo + ((hi - lo) * Math.max(0, bi - 1)) / G;
    const b = lo + ((hi - lo) * Math.min(G, bi + 1)) / G;
    const u = golden((v) => sseAt([Math.exp(v)]), a, b);
    best = sseAt([Math.exp(u)]) <= bs ? [Math.exp(u)] : [Math.exp(lo + ((hi - lo) * bi) / G)];
  } else {
    const G = 50;
    const RATIO = Math.log(2);
    const us = Array.from({ length: G + 1 }, (_, i) => lo + ((hi - lo) * i) / G);
    const pick = svenssonGrid(ts, ys, us, RATIO);
    let b1 = pick ? pick[0] : NaN;
    let b2 = pick ? pick[1] : NaN;
    let bs = pick ? sseAt([Math.exp(b1), Math.exp(b2)]) : Infinity;
    if (!Number.isFinite(bs)) return refuse("The curve points do not identify a Svensson fit (the loadings are collinear at every λ pair).");
    // Refine by Nelder–Mead in (log λ₁, log λ₂) inside the box and the ratio constraint (outside it: +∞), at most
    // 400 iterations, then one alternating golden-section pass along each axis.
    const feasible = (u: number[]): boolean => u[0] >= lo && u[1] <= hi && u[1] - u[0] >= RATIO;
    const nm = nelderMead((u) => (feasible(u) ? sseAt([Math.exp(u[0]), Math.exp(u[1])]) : Infinity), [b1, b2], {
      maxIter: 400,
      tol: 1e-12,
      step: (hi - lo) / G / 2,
    });
    if (feasible(nm.x) && nm.fx < bs) {
      bs = nm.fx;
      b1 = nm.x[0];
      b2 = nm.x[1];
    }
    const step = (hi - lo) / G / 4;
    for (let round = 0; round < 3; round++) {
      const prev = bs;
      const n1 = golden((v) => sseAt([Math.exp(v), Math.exp(b2)]), Math.max(lo, b1 - step), Math.min(b2 - RATIO, b1 + step));
      const s1 = sseAt([Math.exp(n1), Math.exp(b2)]);
      if (s1 < bs) {
        bs = s1;
        b1 = n1;
      }
      const n2 = golden((v) => sseAt([Math.exp(b1), Math.exp(v)]), Math.max(b1 + RATIO, b2 - step), Math.min(hi, b2 + step));
      const s2 = sseAt([Math.exp(b1), Math.exp(n2)]);
      if (s2 < bs) {
        bs = s2;
        b2 = n2;
      }
      if (prev - bs <= 1e-13 * Math.max(1e-300, prev)) break;
    }
    best = [Math.exp(b1), Math.exp(b2)];
  }
  const fit = profile(ts, ys, best);
  if (!fit) return refuse("The least-squares solve failed at the best λ.");
  const fitted = ts.map((t) => nsYield(fit.beta, best, t));
  const mean = ys.reduce((a, v) => a + v, 0) / n;
  const sst = ys.reduce((a, v) => a + (v - mean) * (v - mean), 0);
  const tol = 1e-6;
  const atBound = best.some((l) => Math.abs(Math.log(l) - lo) < tol || Math.abs(Math.log(l) - hi) < tol);
  return {
    model,
    beta: fit.beta,
    lambda: best,
    sse: fit.sse,
    rmse: Math.sqrt(fit.sse / n),
    r2: sst > 0 ? 1 - fit.sse / sst : 1,
    fitted,
    atBound,
  };
}

/**
 * The Svensson grid screen: for every (λ₁, λ₂) grid pair with u₂ − u₁ ≥ ratio (log space), the SSE from the 4 × 4
 * normal equations, built from per-λ loadings computed once (two n-length dot products per pair). Only the pick is
 * used; the refinement and the reported fit use QR.
 */
function svenssonGrid(ts: number[], ys: number[], us: number[], ratio: number): [number, number] | null {
  const n = ts.length;
  const L1s = us.map((u) => Float64Array.from(ts, (t) => L1(t / Math.exp(u))));
  const L2s = us.map((u) => Float64Array.from(ts, (t) => L2(t / Math.exp(u))));
  const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  };
  const sum = (a: ArrayLike<number>): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i];
    return s;
  };
  const yy = dot(ys, ys);
  const sy = sum(ys);
  const s1 = L1s.map(sum);
  const s2 = L2s.map(sum);
  const y1 = L1s.map((v) => dot(v, ys));
  const y2 = L2s.map((v) => dot(v, ys));
  const q11 = L1s.map((v) => dot(v, v));
  const q12 = L1s.map((v, i) => dot(v, L2s[i]));
  const q22 = L2s.map((v) => dot(v, v));
  let best = Infinity;
  let pick: [number, number] | null = null;
  for (let i = 0; i < us.length; i++) {
    for (let j = 0; j < us.length; j++) {
      if (us[j] - us[i] < ratio - 1e-12) continue;
      const a14 = s2[j];
      const a24 = dot(L1s[i], L2s[j]);
      const a34 = dot(L2s[i], L2s[j]);
      const M = [
        [n, s1[i], s2[i], a14, sy],
        [s1[i], q11[i], q12[i], a24, y1[i]],
        [s2[i], q12[i], q22[i], a34, y2[i]],
        [a14, a24, a34, q22[j], y2[j]],
      ];
      const beta = solve4(M);
      if (!beta) continue;
      const sse = yy - (beta[0] * sy + beta[1] * y1[i] + beta[2] * y2[i] + beta[3] * y2[j]);
      if (sse < best) {
        best = sse;
        pick = [us[i], us[j]];
      }
    }
  }
  return pick;
}

/** Gaussian elimination with partial pivoting on a 4 × 5 augmented matrix (overwritten); null if singular. */
function solve4(M: number[][]): number[] | null {
  const p = 4;
  for (let c = 0; c < p; c++) {
    let r = c;
    for (let k = c + 1; k < p; k++) if (Math.abs(M[k][c]) > Math.abs(M[r][c])) r = k;
    if (!(Math.abs(M[r][c]) > 1e-300)) return null;
    [M[c], M[r]] = [M[r], M[c]];
    for (let k = c + 1; k < p; k++) {
      const g = M[k][c] / M[c][c];
      for (let j = c; j <= p; j++) M[k][j] -= g * M[c][j];
    }
  }
  const x = [0, 0, 0, 0];
  for (let c = p - 1; c >= 0; c--) {
    let s = M[c][p];
    for (let j = c + 1; j < p; j++) s -= M[c][j] * x[j];
    x[c] = s / M[c][c];
  }
  return x.every(Number.isFinite) ? x : null;
}

function fmt(x: number): string {
  if (!Number.isFinite(x)) return "a non-number";
  const s = x.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
