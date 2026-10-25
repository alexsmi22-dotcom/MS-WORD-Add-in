/**
 * Panel fixed effects, random effects and the Hausman test (Release E4b), pinned to linearmodels 7.1
 * (panel/model.py PanelOLS and RandomEffects, panel/covariance.py; NCSA licence, Copyright (c) 2017 Kevin Sheppard).
 * The formulas below were read from that source and are re-implemented here, not ported line by line.
 *
 * FIXED EFFECTS (PanelOLS(entity_effects=True, time_effects=…), constant included, singletons kept):
 *  - within transformation: entity effects subtract each entity's mean. Entity + time effects are EXACT on unbalanced
 *    panels, as linearmodels' _demean_both: demean by the dimension with more groups (entities when N > T, else
 *    periods), then partial out the dummies of the other dimension (first level dropped). The dummies' normal
 *    matrix is formed from counts, diag(n_t) − Σ_g c_g c_gᵀ / n_g, never as an n × T matrix; the right-hand sides
 *    from group sums. The grand means are added back and a constant estimated (Stata's _cons).
 *  - a regressor the effects absorb (less than 10⁻⁵ of its norm left, linearmodels' check_absorbed rule) is refused.
 *  - effects counted: N − 1 for entities, plus T − 1 for periods. df_resid = n − k − effects (k counts the constant).
 *  - covariance (debiased=True, linearmodels' default): classical s²(XᵀX)⁻¹ with s² = SSE/df_resid; robust is
 *    White's HC0 times n/(n − effects − k); clustered is Σ_g u_g u_gᵀ times n/(n − extra − k) times
 *    G/(G − 1)·(n − 1)/n (group_debias=True). extra = 0 when the model has ONE effect nested in the clusters (entity
 *    effects, clustered by entity or by a column each entity sits wholly inside), else extra = effects — the
 *    auto_df rule of _determine_df_adjustment. One-way FE clustered by entity is then G/(G − 1)·(n − 1)/(n − k),
 *    Stata's xtreg, fe vce(cluster); with entity AND time effects linearmodels counts every effect, a larger factor
 *    than xtreg, fe with i.time (which does not count the nested entity effects).
 *  - every p-value and interval from t(df_resid), whatever the SE type (Stata's clustered reference is t(G − 1)).
 *  - R²: linearmodels' rsquared (the fully transformed regression; the within R² for entity effects), plus its
 *    within (entity-demeaned), between (entity means) and overall (raw data) R² at the FE coefficients.
 *  - the poolability F that every included effect is zero: ((SSE_pooled − SSE)/effects) / (SSE/df_resid).
 *
 * RANDOM EFFECTS (RandomEffects().fit(small_sample=False)):
 *  - σ²ε = SSE of the within regression / (n − N − rank of the regressors that vary within entities);
 *  - σ²ᵤ = max(0, SSR_between/(N − rank_between) − σ²ε/T̄), T̄ the harmonic mean of the Tᵢ, the between regression
 *    unweighted on the entity means with the constant (Swamy–Arora with a harmonic T̄ on unbalanced panels);
 *  - θᵢ = 1 − √(σ²ε/(Tᵢσ²ᵤ + σ²ε)) per entity; OLS on y − θᵢȳᵢ and x − θᵢx̄ᵢ (the constant becomes 1 − θᵢ);
 *  - covariance scaled by n/(n − k), no effects counted; clustered also by G/(G − 1)·(n − 1)/n; t(n − k).
 *
 * HAUSMAN: (b_FE − b_RE)ᵀ (V_FE − V_RE)⁻¹ (b_FE − b_RE) ~ χ²(q), from the CONVENTIONAL (classical) covariances of
 * both fits whatever SE type is displayed, on the q regressors that vary within entities (no constant). linearmodels
 * has no Hausman test; the oracle is the same formula in numpy on linearmodels' classical covariances.
 */
import type { FittedModel, ModelStat, ModelTerm } from "./regModel";
import { tTestP, fTestP, tCritical } from "./stats";
import { chiSquareP } from "./stats2";
import { magnitudeReason } from "./olsInference";
import { fmtFixed, intText } from "./regTable";
import type { PanelColumns } from "./panelData";

const q = (s: string): string => `“${s}”`;
const EPS = Number.EPSILON;
/** Wall clock for one panel fit (the E3 freeze guarantee: arima.ts ARIMA_WALL_MS). */
export const PANEL_WALL_MS = 6000;
/** Entity + time effects partial out the dummies of the smaller dimension: at most this many groups there. */
export const TWOWAY_MAX_SMALL_DIM = 1000;
/** At most this many regressors (besides the constant). */
export const PANEL_MAX_REGRESSORS = 60;
/** linearmodels' check_absorbed: a column is absorbed when less than this share of its norm survives. */
export const ABSORBED_TOL = 1e-5;

export class PanelRefusal extends Error {}

function checkClock(started: number, what: string): void {
  if (Date.now() - started > PANEL_WALL_MS) {
    throw new PanelRefusal(`The ${what} took longer than ${PANEL_WALL_MS / 1000} s, the limit for one fit in the pane, so it was stopped. Use fewer rows or fewer groups.`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Group means and the within transformation

export interface Groups {
  codes: Int32Array;
  G: number;
  counts: Float64Array;
}

export function makeGroups(codes: Int32Array, G: number): Groups {
  const counts = new Float64Array(G);
  for (let i = 0; i < codes.length; i++) counts[codes[i]]++;
  return { codes, G, counts };
}

export function groupMeans(v: ArrayLike<number>, g: Groups): Float64Array {
  const s = new Float64Array(g.G);
  for (let i = 0; i < v.length; i++) s[g.codes[i]] += v[i];
  for (let j = 0; j < g.G; j++) s[j] /= g.counts[j];
  return s;
}

export function demean(v: ArrayLike<number>, g: Groups): Float64Array {
  const m = groupMeans(v, g);
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - m[g.codes[i]];
  return out;
}

/** True when every entity's rows and every period's rows are linked (the entity–period graph is connected). */
export function connected(ent: Groups, time: Groups): boolean {
  const parent = Int32Array.from({ length: ent.G + time.G }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let i = 0; i < ent.codes.length; i++) {
    const a = find(ent.codes[i]);
    const b = find(ent.G + time.codes[i]);
    if (a !== b) parent[a] = b;
  }
  const root = find(0);
  for (let j = 1; j < ent.G + time.G; j++) if (find(j) !== root) return false;
  return true;
}

/**
 * The two-way within transformation of several columns, exact on unbalanced panels (see the header). Returns the
 * transformed columns in the same order.
 */
export function twoWayTransform(cols: ArrayLike<number>[], ent: Groups, time: Groups, started: number): Float64Array[] {
  // linearmodels: if nentity > nperiods demean by entity and take time dummies, else the reverse.
  const big = ent.G > time.G ? ent : time;
  const small = ent.G > time.G ? time : ent;
  const m = small.G - 1;
  const n = big.codes.length;
  if (m <= 0) return cols.map((c) => demean(c, big));
  // Rows of each big group.
  const start = new Int32Array(big.G + 1);
  for (let i = 0; i < n; i++) start[big.codes[i] + 1]++;
  for (let g = 0; g < big.G; g++) start[g + 1] += start[g];
  const fill = start.slice(0, big.G);
  const rows = new Int32Array(n);
  for (let i = 0; i < n; i++) rows[fill[big.codes[i]]++] = i;
  // S = D'D − Σ_g c_g c_gᵀ / n_g over the dummies 1…m of the small dimension (level 0 dropped).
  const S: Float64Array[] = Array.from({ length: m }, () => new Float64Array(m));
  for (let j = 1; j <= m; j++) S[j - 1][j - 1] = small.counts[j];
  const lev: number[] = [];
  for (let g = 0; g < big.G; g++) {
    lev.length = 0;
    for (let r = start[g]; r < start[g + 1]; r++) {
      const s = small.codes[rows[r]];
      if (s > 0) lev.push(s - 1);
    }
    const ng = start[g + 1] - start[g];
    for (let a = 0; a < lev.length; a++) {
      const Sa = S[lev[a]];
      for (let b = 0; b < lev.length; b++) Sa[lev[b]] -= 1 / ng;
    }
    if ((g & 1023) === 0) checkClock(started, "two-way transformation");
  }
  const L = cholesky(S, started);
  if (!L) throw new PanelRefusal("The entity and time dummies are collinear after the within transformation, so the two-way effects cannot be separated.");
  return cols.map((c) => {
    const v = demean(c, big);
    const r = new Float64Array(m);
    for (let i = 0; i < n; i++) {
      const s = small.codes[i];
      if (s > 0) r[s - 1] += v[i];
    }
    const b = cholSolve(L, r);
    const db = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = small.codes[i];
      db[i] = s > 0 ? b[s - 1] : 0;
    }
    const dbm = demean(db, big);
    for (let i = 0; i < n; i++) v[i] -= dbm[i];
    return v;
  });
}

/** Cholesky factor of a symmetric positive-definite matrix (lower, rows), or null when it is not. */
function cholesky(S: Float64Array[], started?: number): Float64Array[] | null {
  const m = S.length;
  const L: Float64Array[] = Array.from({ length: m }, () => new Float64Array(m));
  let maxDiag = 0;
  for (let i = 0; i < m; i++) maxDiag = Math.max(maxDiag, Math.abs(S[i][i]));
  for (let i = 0; i < m; i++) {
    const Li = L[i];
    for (let j = 0; j <= i; j++) {
      const Lj = L[j];
      let s = S[i][j];
      for (let k = 0; k < j; k++) s -= Li[k] * Lj[k];
      if (i === j) {
        if (!(s > 1e-12 * maxDiag)) return null;
        Li[i] = Math.sqrt(s);
      } else Li[j] = s / Lj[j];
    }
    if (started !== undefined && (i & 63) === 0) checkClock(started, "two-way transformation");
  }
  return L;
}

function cholSolve(L: Float64Array[], b: ArrayLike<number>): Float64Array {
  const m = L.length;
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < m; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

// ---------------------------------------------------------------------------------------------------------------
// Least squares with covariances (Householder QR of centred, unit-norm columns)

export type MeatKind = "classical" | "hc" | "cluster";

export interface LinFit {
  n: number;
  /** Coefficients, constant last when present. */
  k: number;
  names: string[];
  coef: number[];
  resid: Float64Array;
  sse: number;
  /** The covariance (user units) for a meat, before any scale factor; classical uses SSE/s2Denom. */
  vcov: (kind: MeatKind, opt?: { s2Denom?: number; clusters?: Int32Array; G?: number }) => number[][];
  /** Numerical rank of the regressors (columns kept); equals k unless `skipCollinear`. */
  kept: number[];
}

function powerOfTwoAbove(v: ArrayLike<number>): number {
  let mx = 0;
  for (let i = 0; i < v.length; i++) mx = Math.max(mx, Math.abs(v[i]));
  if (!(mx > 0)) return 1;
  return Math.pow(2, Math.ceil(Math.log2(mx)));
}

/**
 * OLS of y on the columns (plus a constant). `shift` adds known means to the constant's mapping (the FE fit passes
 * demeaned columns and the grand means, so the constant is ȳ − x̄ᵀb as in linearmodels without adding the means to
 * the columns and losing their digits). `skipCollinear` drops a collinear column (auxiliary regressions) instead of
 * refusing; the names of the kept columns are reported.
 */
export function linFit(
  y: ArrayLike<number>,
  cols: ArrayLike<number>[],
  names: string[],
  opts: { constant: boolean; shift?: { y: number; x: number[] }; skipCollinear?: boolean; constName?: string },
): LinFit {
  const n = y.length;
  const k0 = cols.length;
  const ys = powerOfTwoAbove(y);
  const yS = Float64Array.from(y, (v) => v / ys);
  const means = new Float64Array(k0);
  if (opts.constant) {
    for (let j = 0; j < k0; j++) {
      let s = 0;
      const c = cols[j];
      for (let i = 0; i < n; i++) s += c[i];
      means[j] = s / n;
    }
  }
  // Design: [1/√n] then the centred, unit-norm columns.
  const design: Float64Array[] = [];
  const scale: number[] = [];
  const which: number[] = []; // design column → user regressor index (−1 = constant)
  if (opts.constant) {
    design.push(new Float64Array(n).fill(1 / Math.sqrt(n)));
    scale.push(Math.sqrt(n));
    which.push(-1);
  }
  for (let j = 0; j < k0; j++) {
    const c = cols[j];
    const z = new Float64Array(n);
    let nrm = 0;
    let raw = 0;
    for (let i = 0; i < n; i++) {
      z[i] = c[i] - means[j];
      nrm += z[i] * z[i];
      raw += c[i] * c[i];
    }
    nrm = Math.sqrt(nrm);
    raw = Math.sqrt(raw);
    if (!(nrm > Math.max(n, 1) * EPS * 16 * Math.max(raw, Number.MIN_VALUE)) || !(nrm > 0)) {
      if (opts.skipCollinear) continue;
      throw new PanelRefusal(
        opts.constant
          ? `${q(names[j])} does not vary in the rows used, so it is perfectly collinear with the constant. Remove it.`
          : `${q(names[j])} is zero in every row used. Remove it.`,
      );
    }
    for (let i = 0; i < n; i++) z[i] /= nrm;
    design.push(z);
    scale.push(nrm);
    which.push(j);
  }
  // Householder QR, in place on copies.
  const p0 = design.length;
  const v: Float64Array[] = [];
  const vtv: number[] = [];
  const Rcols: Float64Array[] = [];
  const keptD: number[] = [];
  const tol = Math.max(n, p0) * EPS * Math.sqrt(p0) * 10;
  for (let d = 0; d < p0; d++) {
    const a = Float64Array.from(design[d]);
    for (let r = 0; r < v.length; r++) reflect(v[r], vtv[r], r, a);
    const kk = v.length;
    let nrm = 0;
    for (let i = kk; i < n; i++) nrm += a[i] * a[i];
    nrm = Math.sqrt(nrm);
    if (!(nrm > tol) || kk >= n) {
      if (opts.skipCollinear) continue;
      const nm = which[d] < 0 ? "the constant" : q(names[which[d]]);
      const earlier = keptD.map((e) => (which[e] < 0 ? "the constant" : q(names[which[e]])));
      throw new PanelRefusal(
        kk >= n
          ? `There are not enough rows for ${p0} coefficients (n = ${intText(n)}).`
          : `Perfect collinearity: ${nm} is a linear combination of ${earlier.join(", ") || "nothing"} in the rows used, so its effect cannot be separated. Drop it or one of the others.`,
      );
    }
    const alpha = a[kk] > 0 ? -nrm : nrm;
    const vk = new Float64Array(n);
    vk[kk] = a[kk] - alpha;
    for (let i = kk + 1; i < n; i++) vk[i] = a[i];
    let vv = 0;
    for (let i = kk; i < n; i++) vv += vk[i] * vk[i];
    v.push(vk);
    vtv.push(vv);
    const rc = new Float64Array(kk + 1);
    for (let i = 0; i < kk; i++) rc[i] = a[i];
    rc[kk] = alpha;
    Rcols.push(rc);
    keptD.push(d);
  }
  const p = keptD.length;
  const R: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let j = 0; j < p; j++) for (let i = 0; i <= j; i++) R[i][j] = Rcols[j][i];
  const qty = Float64Array.from(yS);
  for (let r = 0; r < p; r++) reflect(v[r], vtv[r], r, qty);
  const theta = new Array<number>(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = qty[i];
    for (let j = i + 1; j < p; j++) s -= R[i][j] * theta[j];
    theta[i] = s / R[i][i];
  }
  // Residuals in scaled units.
  const e = Float64Array.from(yS);
  for (let t = 0; t < p; t++) {
    const col = design[keptD[t]];
    const th = theta[t];
    for (let i = 0; i < n; i++) e[i] -= th * col[i];
  }
  let sseS = 0;
  for (let i = 0; i < n; i++) sseS += e[i] * e[i];
  // User parameters: slopes (kept regressors, in order), then the constant. b = G θ (scaled-y units).
  const keptReg = keptD.filter((d) => which[d] >= 0).map((d) => which[d]);
  const hasC = opts.constant;
  const k = keptReg.length + (hasC ? 1 : 0);
  const G: number[][] = Array.from({ length: k }, () => new Array<number>(p).fill(0));
  keptReg.forEach((j, r) => {
    const t = keptD.findIndex((d) => which[d] === j);
    G[r][t] = 1 / scale[keptD[t]];
  });
  const shiftX = opts.shift?.x ?? new Array<number>(k0).fill(0);
  const shiftY = (opts.shift?.y ?? 0) / ys;
  if (hasC) {
    const r = k - 1;
    G[r][0] = 1 / scale[0];
    keptReg.forEach((j) => {
      const t = keptD.findIndex((d) => which[d] === j);
      G[r][t] = -(means[j] + shiftX[j]) / scale[keptD[t]];
    });
  }
  const coef: number[] = G.map((row) => row.reduce((s, g, t) => s + g * theta[t], 0) * ys);
  // θ₀ on the 1/√n column already carries ȳ (y is not centred); the shift adds the means removed before the call.
  if (hasC) coef[k - 1] += shiftY * ys;
  // H = G R⁻¹ (k × p): the covariance is ys² H M_Q Hᵀ with M_Q the meat in Q coordinates.
  const H: number[][] = G.map((row) => {
    // h R = row → solve Rᵀ hᵀ = rowᵀ.
    const h = new Array<number>(p).fill(0);
    for (let i = 0; i < p; i++) {
      let s = row[i];
      for (let t = 0; t < i; t++) s -= R[t][i] * h[t];
      h[i] = s / R[i][i];
    }
    return h;
  });
  let Qcols: Float64Array[] | null = null;
  const thinQ = (): Float64Array[] => {
    if (Qcols) return Qcols;
    Qcols = [];
    for (let t = 0; t < p; t++) {
      const col = new Float64Array(n);
      col[t] = 1;
      for (let r = t; r >= 0; r--) reflect(v[r], vtv[r], r, col);
      Qcols.push(col);
    }
    return Qcols;
  };
  const vcov = (kind: MeatKind, opt: { s2Denom?: number; clusters?: Int32Array; G?: number } = {}): number[][] => {
    let M: number[][];
    if (kind === "classical") {
      const s2 = sseS / (opt.s2Denom ?? n - p);
      M = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => (a === b ? s2 : 0)));
    } else if (kind === "hc") {
      const Q = thinQ();
      M = Array.from({ length: p }, () => new Array<number>(p).fill(0));
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) w[i] = e[i] * e[i];
      for (let a = 0; a < p; a++)
        for (let b = 0; b <= a; b++) {
          let s = 0;
          const qa = Q[a];
          const qb = Q[b];
          for (let i = 0; i < n; i++) s += w[i] * qa[i] * qb[i];
          M[a][b] = s;
          M[b][a] = s;
        }
    } else {
      const Q = thinQ();
      const Gc = opt.G!;
      const cl = opt.clusters!;
      const U: Float64Array[] = Array.from({ length: Gc }, () => new Float64Array(p));
      for (let a = 0; a < p; a++) {
        const qa = Q[a];
        for (let i = 0; i < n; i++) U[cl[i]][a] += e[i] * qa[i];
      }
      M = Array.from({ length: p }, () => new Array<number>(p).fill(0));
      for (const u of U)
        for (let a = 0; a < p; a++) {
          if (u[a] === 0) continue;
          for (let b = 0; b < p; b++) M[a][b] += u[a] * u[b];
        }
    }
    const ys2 = ys * ys;
    return H.map((ha) =>
      H.map((hb) => {
        let s = 0;
        for (let a = 0; a < p; a++) {
          if (ha[a] === 0) continue;
          let t = 0;
          for (let b = 0; b < p; b++) t += M[a][b] * hb[b];
          s += ha[a] * t;
        }
        return s * ys2;
      }),
    );
  };
  const outNames = [...keptReg.map((j) => names[j]), ...(hasC ? [opts.constName ?? "Constant"] : [])];
  const resid = Float64Array.from(e, (x) => x * ys);
  return { n, k, names: outNames, coef, resid, sse: sseS * ys * ys, vcov, kept: keptReg };
}

function reflect(vk: Float64Array, vv: number, k: number, a: Float64Array): void {
  if (vv === 0) return;
  let dot = 0;
  const n = a.length;
  for (let i = k; i < n; i++) dot += vk[i] * a[i];
  const f = (2 * dot) / vv;
  if (f === 0) return;
  for (let i = k; i < n; i++) a[i] -= f * vk[i];
}

/** Wald F that the listed coefficients are zero under V, or null when V's block is not positive definite. */
export function waldF(coef: number[], V: number[][], idx: number[], df2: number): { value: number; df1: number; df2: number; p: number } | null {
  if (!idx.length) return null;
  const S = idx.map((a) => Float64Array.from(idx.map((b) => V[a][b])));
  const L = cholesky(S);
  if (!L) return null;
  const b = idx.map((a) => coef[a]);
  const x = cholSolve(L, b);
  let w = 0;
  for (let a = 0; a < idx.length; a++) w += b[a] * x[a];
  const value = w / idx.length;
  return { value, df1: idx.length, df2, p: fTestP(value, idx.length, df2) };
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed effects

export type PanelSe = "classical" | "robust" | "cluster-entity" | "cluster-column";

export const PANEL_SE_OPTIONS: { value: PanelSe; label: string }[] = [
  { value: "cluster-entity", label: "Clustered by entity" },
  { value: "robust", label: "Robust (White)" },
  { value: "classical", label: "Classical" },
  { value: "cluster-column", label: "Clustered by a named column" },
];

export interface PanelFitResult {
  model: FittedModel;
  coef: number[];
  /** Covariance under the chosen SE type (user units, constant last). */
  V: number[][];
  /** Classical (conventional) covariance, for the Hausman test. */
  Vclassical: number[][];
  names: string[];
  dfResid: number;
  /** Rows, entities, periods used. */
  n: number;
  N: number;
  T: number;
  r2: number;
  r2Within: number;
  r2Between: number;
  r2Overall: number;
  f: { value: number; df1: number; df2: number; p: number } | null;
  fWhy?: string;
  sse: number;
  resid: Float64Array;
  notes: string[];
}

export interface FeResult extends PanelFitResult {
  effects: "entity" | "twoway";
  neffects: number;
  pooledF: { value: number; df1: number; df2: number; p: number } | { skipped: string };
  /** Regressors the effects do not absorb (all of them, for a successful FE fit). */
}

/** The SE choice resolved against the panel: clusters, and whether the effects are nested in them. */
function clusterSetup(p: PanelColumns, se: PanelSe): { codes: Int32Array; G: number; name: string; entityNested: boolean } | null {
  if (se === "cluster-entity") return { codes: p.entity, G: p.N, name: p.entityName, entityNested: true };
  if (se === "cluster-column") {
    if (!p.cluster) throw new PanelRefusal("Name the cluster column (clustered standard errors).");
    // Nested: every entity sits in one cluster.
    const of = new Int32Array(p.N).fill(-1);
    let nested = true;
    for (let i = 0; i < p.n; i++) {
      const e = p.entity[i];
      if (of[e] < 0) of[e] = p.cluster.codes[i];
      else if (of[e] !== p.cluster.codes[i]) {
        nested = false;
        break;
      }
    }
    return { codes: p.cluster.codes, G: p.cluster.G, name: p.cluster.name, entityNested: nested };
  }
  return null;
}

function checkInputs(p: PanelColumns): void {
  if (!p.X.length) throw new PanelRefusal("Add at least one regressor after the ~.");
  if (p.X.length > PANEL_MAX_REGRESSORS) throw new PanelRefusal(`At most ${PANEL_MAX_REGRESSORS} regressors fit in one panel model.`);
  const ym = magnitudeReason(p.y, p.depName);
  if (ym) throw new PanelRefusal(ym);
  p.X.forEach((c, j) => {
    const m = magnitudeReason(c, p.names[j]);
    if (m) throw new PanelRefusal(m);
  });
}

function norm(v: ArrayLike<number>): number {
  // Scaled to avoid overflow at 10¹⁰⁰.
  let mx = 0;
  for (let i = 0; i < v.length; i++) mx = Math.max(mx, Math.abs(v[i]));
  if (mx === 0) return 0;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] / mx) ** 2;
  return Math.sqrt(s) * mx;
}

function mean(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / v.length;
}

/** 1 − rss/tss, NaN when tss is zero to rounding. */
function r2Of(rss: number, tss: number, yss: number, n: number): number {
  if (!(tss > Math.max(yss, Number.MIN_VALUE) * n * EPS * 8)) return NaN;
  return 1 - rss / tss;
}

/** linearmodels' within, between and overall R² at given coefficients (slopes, then the constant). */
function threeR2(p: PanelColumns, ent: Groups, slopes: number[], cols: number[], cst: number): { w: number; b: number; o: number } {
  const n = p.n;
  const xb = new Float64Array(n);
  cols.forEach((j, r) => {
    const c = p.X[j];
    const b = slopes[r];
    for (let i = 0; i < n; i++) xb[i] += b * c[i];
  });
  let yss = 0;
  for (let i = 0; i < n; i++) yss += p.y[i] * p.y[i];
  // Overall.
  const ym = mean(p.y);
  let rss = 0;
  let tss = 0;
  for (let i = 0; i < n; i++) {
    rss += (p.y[i] - xb[i] - cst) ** 2;
    tss += (p.y[i] - ym) ** 2;
  }
  const o = r2Of(rss, tss, yss, n);
  // Within (entity-demeaned; the constant drops out).
  const yd = demean(p.y, ent);
  const xbd = demean(xb, ent);
  rss = 0;
  tss = 0;
  for (let i = 0; i < n; i++) {
    rss += (yd[i] - xbd[i]) ** 2;
    tss += yd[i] * yd[i];
  }
  const w = r2Of(rss, tss, yss, n);
  // Between (entity means, unweighted).
  const ybar = groupMeans(p.y, ent);
  const xbbar = groupMeans(xb, ent);
  const mb = mean(ybar);
  rss = 0;
  tss = 0;
  let ybss = 0;
  for (let g = 0; g < ent.G; g++) {
    rss += (ybar[g] - xbbar[g] - cst) ** 2;
    tss += (ybar[g] - mb) ** 2;
    ybss += ybar[g] * ybar[g];
  }
  const b = r2Of(rss, tss, ybss, ent.G);
  return { w, b, o };
}

function termsFrom(names: string[], coef: number[], V: number[][], df: number, seLabel: string): ModelTerm[] {
  const tc = tCritical(0.05, df);
  return names.map((name, a) => {
    const se = Math.sqrt(Math.max(V[a][a], 0));
    if (!(se > 0) || !Number.isFinite(se)) throw new PanelRefusal(`The standard error of ${q(name)} is zero under ${seLabel}, so its t statistic is undefined.`);
    const t = coef[a] / se;
    return { name, coef: coef[a], se, stat: t, p: tTestP(t, df), ciLo: coef[a] - tc * se, ciHi: coef[a] + tc * se };
  });
}

function scaleMatrix(V: number[][], f: number): number[][] {
  return V.map((r) => r.map((x) => x * f));
}

function assertFinite(model: FittedModel): void {
  for (const t of model.terms)
    for (const v of [t.coef, t.se, t.stat, t.p, t.ciLo, t.ciHi])
      if (!Number.isFinite(v)) throw new PanelRefusal(`The estimate for ${q(t.name)} is not a finite number at this scale; rescale the data.`);
}

/** Panel fixed effects (linearmodels PanelOLS). */
export function fitFixedEffects(p: PanelColumns, opts: { effects: "entity" | "twoway"; se: PanelSe }): FeResult {
  const started = Date.now();
  checkInputs(p);
  const n = p.n;
  const k = p.X.length + 1;
  const twoway = opts.effects === "twoway";
  const ent = makeGroups(p.entity, p.N);
  const tim = makeGroups(p.time, p.T);
  if (twoway && Math.min(p.N, p.T) > TWOWAY_MAX_SMALL_DIM) {
    throw new PanelRefusal(
      `Entity and time effects partial out the dummies of the smaller dimension; this panel has ${intText(p.N)} entities and ${intText(p.T)} periods, ` +
        `and at most ${intText(TWOWAY_MAX_SMALL_DIM)} are allowed in the smaller one.`,
    );
  }
  if (twoway && p.N > 1 && p.T > 1 && !connected(ent, tim)) {
    throw new PanelRefusal(
      "The panel splits into separate groups of entities observed in periods that never overlap, so the entity and time effects " +
        "cannot be told apart across the groups. Fit each group separately, or use entity effects only.",
    );
  }
  const neffects = p.N - 1 + (twoway ? p.T - 1 : 0);
  const dfResid = n - k - neffects;
  if (dfResid <= 0) {
    throw new PanelRefusal(
      `${intText(n)} rows leave no residual degrees of freedom for ${k} coefficients and ${intText(neffects)} effects ` +
        `(${intText(p.N)} entities${twoway ? `, ${intText(p.T)} periods` : ""}).`,
    );
  }
  const cols = [p.y, ...p.X];
  const tr = twoway ? twoWayTransform(cols, ent, tim, started) : cols.map((c) => demean(c, ent));
  checkClock(started, "fixed-effects fit");
  const yT = tr[0];
  const XT = tr.slice(1);
  // Absorbed regressors (linearmodels' check_absorbed).
  XT.forEach((c, j) => {
    const raw = norm(p.X[j]);
    if (raw === 0) throw new PanelRefusal(`${q(p.names[j])} is zero in every row used. Remove it.`);
    if (!(norm(c) >= ABSORBED_TOL * raw)) {
      throw new PanelRefusal(
        twoway
          ? `${q(p.names[j])} is absorbed by the entity and time effects (it is a sum of an entity part and a period part), so its effect cannot be estimated. Remove it, or use entity effects only.`
          : `${q(p.names[j])} does not vary within entities (it is constant for each ${p.entityName}), so the entity effects absorb it. Remove it, or use random effects.`,
      );
    }
  });
  const fit = linFit(yT, XT, p.names, { constant: true, shift: { y: mean(p.y), x: p.X.map(mean) } });
  checkClock(started, "fixed-effects fit");
  const cl = clusterSetup(p, opts.se);
  let V: number[][];
  let seLabel: string;
  const notes: string[] = [];
  const Vc = fit.vcov("classical", { s2Denom: dfResid * 1 });
  // vcov("classical") divides the scaled SSE by s2Denom: s² = SSE/df_resid.
  if (opts.se === "classical") {
    V = Vc;
    seLabel = "Classical";
    notes.push(`Standard errors: classical, s² = SSE/(n − k − effects) with ${intText(neffects)} effects counted (linearmodels cov_type="unadjusted", debiased=True).`);
  } else if (opts.se === "robust") {
    V = scaleMatrix(fit.vcov("hc"), n / (n - neffects - k));
    seLabel = "Robust (White)";
    notes.push(
      `Standard errors: White's heteroskedasticity-robust sandwich times n/(n − k − effects) (linearmodels cov_type="robust", debiased=True). ` +
        "This is not Stata's xtreg, fe robust, which clusters by entity.",
    );
  } else {
    const c = cl!;
    if (c.G < 2) throw new PanelRefusal(`Clustered standard errors need at least two clusters; ${q(c.name)} has one value in every row used.`);
    const nested = !twoway && c.entityNested;
    const extra = nested ? 0 : neffects;
    const factor = (n / (n - extra - k)) * (c.G / (c.G - 1)) * ((n - 1) / n);
    V = scaleMatrix(fit.vcov("cluster", { clusters: c.codes, G: c.G }), factor);
    seLabel = `Clustered by ${c.name}, ${intText(c.G)} clusters`;
    notes.push(
      nested
        ? `Standard errors: clustered by ${c.name} (${intText(c.G)} clusters). The entity effects are nested in the clusters, so they are not counted: factor G/(G − 1)·(n − 1)/(n − k), Stata's xtreg, fe vce(cluster) (linearmodels cov_type="clustered", debiased=True, group_debias=True).`
        : `Standard errors: clustered by ${c.name} (${intText(c.G)} clusters), factor n/(n − k − effects)·G/(G − 1)·(n − 1)/n with all ${intText(neffects)} effects counted, as linearmodels does ${twoway ? "whenever the model has entity and time effects" : "when the entity effects are not nested in the clusters"} (cov_type="clustered", debiased=True, group_debias=True)` +
            (twoway ? "; Stata's xtreg, fe with i.time dummies does not count the nested entity effects and prints smaller standard errors." : "."),
    );
    if (c.G < 30) notes.push(`Only ${c.G} clusters: cluster-robust inference is unreliable with few clusters.`);
  }
  notes.push(`p-values and intervals from t with n − k − effects = ${intText(dfResid)} df, for every SE type (linearmodels' convention; Stata uses G − 1 df for clustered errors).`);
  const terms = termsFrom(fit.names, fit.coef, V, dfResid, seLabel);
  const slopeIdx = fit.names.map((_, a) => a).slice(0, k - 1);
  let f = waldF(fit.coef, V, slopeIdx, dfResid);
  let fWhy: string | undefined;
  if (!f) fWhy = "F is not reported: the covariance of the slopes is singular.";
  else if (cl && slopeIdx.length > cl.G - 1) {
    f = null;
    fWhy = `F is not reported: ${slopeIdx.length} restrictions exceed G − 1 = ${cl.G - 1}.`;
  }
  // R²s.
  let tss = 0;
  let yss = 0;
  for (let i = 0; i < n; i++) {
    tss += yT[i] * yT[i];
    yss += p.y[i] * p.y[i];
  }
  const r2 = r2Of(fit.sse, tss, yss, n);
  const three = threeR2(p, ent, fit.coef.slice(0, k - 1), p.X.map((_, j) => j), fit.coef[k - 1]);
  // Poolability F.
  let pooledF: FeResult["pooledF"];
  try {
    const pooled = linFit(p.y, p.X, p.names, { constant: true });
    const num = (pooled.sse - fit.sse) / neffects;
    const den = fit.sse / dfResid;
    if (neffects <= 0) pooledF = { skipped: "the effects use no degrees of freedom" };
    else if (!(den > 0)) pooledF = { skipped: "the residual sum of squares is 0" };
    else {
      const v = Math.max(num / den, 0);
      pooledF = { value: v, df1: neffects, df2: dfResid, p: fTestP(v, neffects, dfResid) };
    }
  } catch (e) {
    if (!(e instanceof PanelRefusal)) throw e;
    pooledF = { skipped: `the pooled regression cannot be fitted (${e.message})` };
  }
  notes.push(
    twoway
      ? "Entity and time effects, removed exactly (demeaning by the larger dimension and partialling out the other's dummies, as linearmodels' PanelOLS); a constant is estimated with the grand means added back (Stata's _cons)."
      : "Entity effects removed by demeaning each entity; a constant is estimated with the grand means added back (Stata's _cons).",
  );
  notes.push("Entities with a single row (singletons) are kept, as linearmodels' default singletons=True; they add nothing to the slopes but are counted among the effects.");
  notes.push(
    twoway
      ? "R² is the R² of the fully transformed (entity- and time-demeaned) regression, linearmodels' rsquared; the within R² (entity-demeaned only), between R² (entity means) and overall R² (raw data) are at the same coefficients."
      : "R² is the within R² (entity-demeaned regression), linearmodels' rsquared; between R² (entity means) and overall R² (raw data) are at the same coefficients.",
  );
  notes.push(`The pooled F tests that all ${intText(neffects)} included effects are zero against pooled OLS (linearmodels' f_pooled).`);
  const stats: ModelStat[] = [
    { label: "R²", value: r2 },
    { label: "R² within", value: three.w },
    { label: "R² between", value: three.b },
    { label: "R² overall", value: three.o },
  ];
  if (f) stats.push({ label: "F", value: f.value }, { label: "Prob > F", value: f.p });
  if (!("skipped" in pooledF)) stats.push({ label: "Pooled F (effects)", value: pooledF.value });
  stats.push({ label: "Entities", value: p.N, decimals: 0 }, { label: "Periods", value: p.T, decimals: 0 });
  for (const s of stats) if (!Number.isFinite(s.value) && s.label === "R²") throw new PanelRefusal("R² is not defined: the transformed response does not vary (every row is explained by the effects).");
  const model: FittedModel = {
    kind: "fe",
    depName: p.depName,
    n,
    terms,
    statLabel: "t",
    df: dfResid,
    seLabel,
    stats: stats.filter((s) => Number.isFinite(s.value)),
    notes,
  };
  assertFinite(model);
  return {
    model,
    coef: fit.coef,
    V,
    Vclassical: Vc,
    names: fit.names,
    dfResid,
    n,
    N: p.N,
    T: p.T,
    r2,
    r2Within: three.w,
    r2Between: three.b,
    r2Overall: three.o,
    f,
    fWhy,
    sse: fit.sse,
    resid: fit.resid,
    notes,
    effects: opts.effects,
    neffects,
    pooledF,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Random effects

export interface ReResult extends PanelFitResult {
  sigma2e: number;
  sigma2u: number;
  rho: number;
  thetaMin: number;
  thetaMax: number;
  /** Regressors that vary within entities (the Hausman test's). */
  timeVarying: string[];
}

/** Panel random effects (linearmodels RandomEffects, small_sample=False). */
export function fitRandomEffects(p: PanelColumns, opts: { se: PanelSe }): ReResult {
  const started = Date.now();
  checkInputs(p);
  const n = p.n;
  const k = p.X.length + 1;
  const ent = makeGroups(p.entity, p.N);
  if (p.N < 2) throw new PanelRefusal("Random effects need at least two entities.");
  // Within regression: σ²ε. Regressors that do not vary within entities have no coefficient there.
  const yd = demean(p.y, ent);
  const Xd = p.X.map((c) => demean(c, ent));
  const tv: number[] = [];
  Xd.forEach((c, j) => {
    const raw = norm(p.X[j]);
    if (raw === 0) throw new PanelRefusal(`${q(p.names[j])} is zero in every row used. Remove it.`);
    if (norm(c) >= ABSORBED_TOL * raw) tv.push(j);
  });
  let sseW: number;
  if (tv.length) {
    const w = linFit(yd, tv.map((j) => Xd[j]), tv.map((j) => p.names[j]), { constant: true, shift: { y: 0, x: tv.map(() => 0) } });
    sseW = w.sse;
  } else {
    sseW = 0;
    for (let i = 0; i < n; i++) sseW += yd[i] * yd[i];
  }
  const dfW = n - p.N - tv.length;
  if (dfW <= 0) {
    throw new PanelRefusal(
      `σ²ε cannot be estimated: the within regression has no residual degrees of freedom (${intText(n)} rows, ${intText(p.N)} entities, ` +
        `${tv.length} regressor${tv.length === 1 ? "" : "s"} varying within entities; at least ${intText(p.N + tv.length + 1)} rows are needed).`,
    );
  }
  const sigma2e = sseW / dfW;
  // Between regression: entity means, unweighted, with the constant.
  const ybar = groupMeans(p.y, ent);
  const Xbar = p.X.map((c) => groupMeans(c, ent));
  let between: LinFit;
  try {
    between = linFit(ybar, Xbar, p.names, { constant: true });
  } catch (e) {
    if (!(e instanceof PanelRefusal)) throw e;
    throw new PanelRefusal(`σ²ᵤ cannot be estimated from the between regression on the entity means: ${e.message}`);
  }
  const dfB = p.N - k;
  if (dfB <= 0) {
    throw new PanelRefusal(`σ²ᵤ cannot be estimated: the between regression on ${intText(p.N)} entity means has no residual degrees of freedom for ${k} coefficients (at least ${k + 1} entities are needed).`);
  }
  let invSum = 0;
  for (let g = 0; g < p.N; g++) invSum += 1 / ent.counts[g];
  const tBar = p.N / invSum;
  const sigma2u = Math.max(0, between.sse / dfB - sigma2e / tBar);
  const rho = sigma2u / (sigma2u + sigma2e);
  const theta = new Float64Array(p.N);
  let thetaMin = Infinity;
  let thetaMax = -Infinity;
  for (let g = 0; g < p.N; g++) {
    theta[g] = 1 - Math.sqrt(sigma2e / (ent.counts[g] * sigma2u + sigma2e));
    thetaMin = Math.min(thetaMin, theta[g]);
    thetaMax = Math.max(thetaMax, theta[g]);
  }
  checkClock(started, "random-effects fit");
  // Quasi-demeaned regression; the constant becomes 1 − θᵢ.
  const wy = new Float64Array(n);
  for (let i = 0; i < n; i++) wy[i] = p.y[i] - theta[p.entity[i]] * ybar[p.entity[i]];
  const wX = p.X.map((c, j) => {
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = c[i] - theta[p.entity[i]] * Xbar[j][p.entity[i]];
    return o;
  });
  const wc = new Float64Array(n);
  for (let i = 0; i < n; i++) wc[i] = 1 - theta[p.entity[i]];
  const CONST = "Constant";
  const fit = linFit(wy, [...wX, wc], [...p.names, CONST], { constant: false });
  const dfResid = n - k;
  if (dfResid <= 0) throw new PanelRefusal(`${intText(n)} rows leave no residual degrees of freedom for ${k} coefficients.`);
  const cl = clusterSetup(p, opts.se);
  const Vc = fit.vcov("classical", { s2Denom: dfResid });
  let V: number[][];
  let seLabel: string;
  const notes: string[] = [];
  if (opts.se === "classical") {
    V = Vc;
    seLabel = "Classical";
    notes.push('Standard errors: classical, s² = SSE/(n − k) of the quasi-demeaned regression (linearmodels cov_type="unadjusted", debiased=True).');
  } else if (opts.se === "robust") {
    V = scaleMatrix(fit.vcov("hc"), n / (n - k));
    seLabel = "Robust (White)";
    notes.push('Standard errors: White\'s robust sandwich on the quasi-demeaned regression times n/(n − k) (linearmodels cov_type="robust", debiased=True).');
  } else {
    const c = cl!;
    if (c.G < 2) throw new PanelRefusal(`Clustered standard errors need at least two clusters; ${q(c.name)} has one value in every row used.`);
    V = scaleMatrix(fit.vcov("cluster", { clusters: c.codes, G: c.G }), (c.G / (c.G - 1)) * ((n - 1) / (n - k)));
    seLabel = `Clustered by ${c.name}, ${intText(c.G)} clusters`;
    notes.push(
      `Standard errors: clustered by ${c.name} (${intText(c.G)} clusters) on the quasi-demeaned regression, factor G/(G − 1)·(n − 1)/(n − k) (linearmodels cov_type="clustered", debiased=True, group_debias=True).`,
    );
    if (c.G < 30) notes.push(`Only ${c.G} clusters: cluster-robust inference is unreliable with few clusters.`);
  }
  notes.push(`p-values and intervals from t with n − k = ${intText(dfResid)} df.`);
  const terms = termsFrom(fit.names, fit.coef, V, dfResid, seLabel);
  const slopeIdx = fit.names.map((_, a) => a).slice(0, k - 1);
  let f = waldF(fit.coef, V, slopeIdx, dfResid);
  let fWhy: string | undefined;
  if (!f) fWhy = "F is not reported: the covariance of the slopes is singular.";
  else if (cl && slopeIdx.length > cl.G - 1) {
    f = null;
    fWhy = `F is not reported: ${slopeIdx.length} restrictions exceed G − 1 = ${cl.G - 1}.`;
  }
  const wm = mean(wy);
  let tss = 0;
  let yss = 0;
  for (let i = 0; i < n; i++) {
    tss += (wy[i] - wm) ** 2;
    yss += p.y[i] * p.y[i];
  }
  const r2 = r2Of(fit.sse, tss, yss, n);
  const three = threeR2(p, ent, fit.coef.slice(0, k - 1), p.X.map((_, j) => j), fit.coef[k - 1]);
  notes.push(
    "Random effects by feasible GLS (linearmodels RandomEffects, small_sample=False): σ²ε from the within regression, " +
      "σ²ᵤ = max(0, SSR_between/(N − k) − σ²ε/T̄) from the unweighted regression of the entity means, T̄ the harmonic mean of the rows per entity, " +
      "and θᵢ = 1 − √(σ²ε/(Tᵢσ²ᵤ + σ²ε)) for each entity.",
  );
  if (sigma2u === 0) notes.push("σ²ᵤ was estimated below zero and set to 0, so θ = 0 and random effects are pooled OLS.");
  notes.push("R² is linearmodels' rsquared (the quasi-demeaned regression); within, between and overall R² are at the same coefficients.");
  const stats: ModelStat[] = [
    { label: "R²", value: r2 },
    { label: "R² within", value: three.w },
    { label: "R² between", value: three.b },
    { label: "R² overall", value: three.o },
  ];
  if (f) stats.push({ label: "F", value: f.value }, { label: "Prob > F", value: f.p });
  stats.push(
    { label: "σ²ᵤ", value: sigma2u },
    { label: "σ²ε", value: sigma2e },
    { label: "ρ", value: rho },
    { label: "Entities", value: p.N, decimals: 0 },
  );
  const model: FittedModel = {
    kind: "re",
    depName: p.depName,
    n,
    terms,
    statLabel: "t",
    df: dfResid,
    seLabel,
    stats: stats.filter((s) => Number.isFinite(s.value)),
    notes,
  };
  assertFinite(model);
  return {
    model,
    coef: fit.coef,
    V,
    Vclassical: Vc,
    names: fit.names,
    dfResid,
    n,
    N: p.N,
    T: p.T,
    r2,
    r2Within: three.w,
    r2Between: three.b,
    r2Overall: three.o,
    f,
    fWhy,
    sse: fit.sse,
    resid: fit.resid,
    notes,
    sigma2e,
    sigma2u,
    rho,
    thetaMin,
    thetaMax,
    timeVarying: tv.map((j) => p.names[j]),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hausman

export type HausmanResult = { stat: number; df: number; p: number; names: string[] } | { skipped: string };

/** Hausman FE vs RE from the classical covariances, on the regressors both estimate that vary within entities. */
export function hausman(fe: FeResult, re: ReResult): HausmanResult {
  const names = re.timeVarying.filter((nm) => fe.names.includes(nm));
  if (!names.length) return { skipped: "no regressor varies within entities, so fixed effects estimate nothing to compare" };
  const fi = names.map((nm) => fe.names.indexOf(nm));
  const ri = names.map((nm) => re.names.indexOf(nm));
  const d = names.map((_, a) => fe.coef[fi[a]] - re.coef[ri[a]]);
  const S = names.map((_, a) => Float64Array.from(names.map((__, b) => fe.Vclassical[fi[a]][fi[b]] - re.Vclassical[ri[a]][ri[b]])));
  // Relative tolerance: the difference must be positive definite against the size of V_FE.
  let scale = 0;
  for (let a = 0; a < names.length; a++) scale = Math.max(scale, Math.abs(fe.Vclassical[fi[a]][fi[a]]));
  const L = choleskyRel(S, scale);
  if (!L) {
    return {
      skipped:
        "V_FE − V_RE is not positive definite for these data (random effects are not more efficient here), so the Hausman statistic is not defined",
    };
  }
  const x = cholSolve(L, d);
  let h = 0;
  for (let a = 0; a < d.length; a++) h += d[a] * x[a];
  if (!Number.isFinite(h)) return { skipped: "the Hausman statistic is not a finite number at this scale" };
  return { stat: h, df: names.length, p: chiSquareP(h, names.length), names };
}

function choleskyRel(S: Float64Array[], scale: number): Float64Array[] | null {
  const m = S.length;
  const L: Float64Array[] = Array.from({ length: m }, () => new Float64Array(m));
  for (let i = 0; i < m; i++)
    for (let j = 0; j <= i; j++) {
      let s = S[i][j];
      for (let t = 0; t < j; t++) s -= L[i][t] * L[j][t];
      if (i === j) {
        if (!(s > 1e-10 * scale)) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  return L;
}

/** "0.412 to 0.588" or "0.500 (every entity)". */
export function thetaText(re: ReResult): string {
  return Math.abs(re.thetaMax - re.thetaMin) <= 1e-12 ? `${fmtFixed(re.thetaMin, 3)} (every entity)` : `${fmtFixed(re.thetaMin, 3)} to ${fmtFixed(re.thetaMax, 3)}`;
}
