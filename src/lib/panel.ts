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
 *    A disconnected two-way panel (c groups of entities in periods that never overlap) is fitted exactly: the first
 *    period (or entity) dummy of each group is dropped, and N + T − 1 − c effects are counted, the dummies' rank
 *    (linearmodels counts N + T − 2 whatever c; its slopes are the same).
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
 * both fits whatever SE type is displayed, on the q regressors that vary within entities (no constant). When that
 * difference is not positive definite (usual when a regressor is correlated with the entity effect, because the
 * two fits estimate σ² differently), Stata's `hausman, sigmamore`: both covariances on the efficient (RE)
 * estimator's disturbance variance, e(rmse)² of xtreg, re; if that difference is singular, the Moore–Penrose
 * inverse with df = its rank (Stata's documented rule). linearmodels has no Hausman test; the oracle is the same
 * formulas in numpy on linearmodels' classical covariances.
 */
import type { FittedModel, ModelStat, ModelTerm } from "./regModel";
import { tTestP, fTestP, tCritical } from "./stats";
import { chiSquareP } from "./stats2";
import { magnitudeReason } from "./olsInference";
import { fmtFixed, intText, numText } from "./regTable";
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
/** Rows × coefficients for one fit (each n × k copy is 8 bytes a cell; several copies are live during a fit). */
export const PANEL_MAX_CELLS = 2_000_000;

export class PanelRefusal extends Error {}
/** The wall clock ran out: never swallowed by an optional step. */
export class PanelTimeout extends PanelRefusal {}

function checkClock(started: number, what: string): void {
  if (Date.now() - started > PANEL_WALL_MS) {
    throw new PanelTimeout(`The ${what} took longer than ${PANEL_WALL_MS / 1000} s, the limit for one fit in the pane, so it was stopped. Use fewer rows or fewer groups.`);
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

/**
 * The connected components of the entity–period graph (an edge for every row): the component of each entity
 * (nodes 0…N−1) and each period (nodes N…N+T−1), numbered 0… in order of first node.
 */
export function components(ent: Groups, time: Groups): { count: number; comp: Int32Array } {
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
  const label = new Int32Array(ent.G + time.G).fill(-1);
  const comp = new Int32Array(ent.G + time.G);
  let count = 0;
  for (let j = 0; j < ent.G + time.G; j++) {
    const r = find(j);
    if (label[r] < 0) label[r] = count++;
    comp[j] = label[r];
  }
  return { count, comp };
}

/** True when every entity's rows and every period's rows are linked (the entity–period graph is connected). */
export function connected(ent: Groups, time: Groups): boolean {
  return components(ent, time).count === 1;
}

/**
 * The two-way within transformation of several columns, exact on unbalanced panels (see the header). Returns the
 * transformed columns in the same order.
 */
export function twoWayTransform(cols: ArrayLike<number>[], ent: Groups, time: Groups, started: number): Float64Array[] {
  // linearmodels: if nentity > nperiods demean by entity and take time dummies, else the reverse.
  const big = ent.G > time.G ? ent : time;
  const small = ent.G > time.G ? time : ent;
  const n = big.codes.length;
  // The dummies of the small dimension, less the first level of each connected component: on a connected panel
  // only level 0 is dropped; each further component adds one exact dependency (its dummies sum to a function of the
  // big groups it holds), so its first level is dropped too.
  const cc = components(ent, time);
  const offset = small === ent ? 0 : ent.G;
  const seen = new Uint8Array(cc.count);
  const colOf = new Int32Array(small.G).fill(-1);
  let m = 0;
  for (let s = 0; s < small.G; s++) {
    const c = cc.comp[offset + s];
    if (!seen[c]) seen[c] = 1;
    else colOf[s] = m++;
  }
  if (m <= 0) return cols.map((c) => demean(c, big));
  // Rows of each big group.
  const start = new Int32Array(big.G + 1);
  for (let i = 0; i < n; i++) start[big.codes[i] + 1]++;
  for (let g = 0; g < big.G; g++) start[g + 1] += start[g];
  const fill = start.slice(0, big.G);
  const rows = new Int32Array(n);
  for (let i = 0; i < n; i++) rows[fill[big.codes[i]]++] = i;
  // S = D'D − Σ_g c_g c_gᵀ / n_g over the kept dummies of the small dimension.
  const S: Float64Array[] = Array.from({ length: m }, () => new Float64Array(m));
  for (let s = 0; s < small.G; s++) if (colOf[s] >= 0) S[colOf[s]][colOf[s]] = small.counts[s];
  const lev: number[] = [];
  for (let g = 0; g < big.G; g++) {
    lev.length = 0;
    for (let r = start[g]; r < start[g + 1]; r++) {
      const s = colOf[small.codes[rows[r]]];
      if (s >= 0) lev.push(s);
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
      const s = colOf[small.codes[i]];
      if (s >= 0) r[s] += v[i];
    }
    const b = cholSolve(L, r);
    const db = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = colOf[small.codes[i]];
      db[i] = s >= 0 ? b[s] : 0;
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
  opts: { constant: boolean; shift?: { y: number; x: number[] }; skipCollinear?: boolean; constName?: string; started?: number },
): LinFit {
  const started = opts.started ?? Date.now();
  const tick = (): void => checkClock(started, "regression");
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
    const z = new Float64Array(n);
    const sq = centreInto(z, cols[j], means[j]);
    const nrm = Math.sqrt(sq.centred);
    const raw = Math.sqrt(sq.raw);
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
    tick();
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
    axpy(e, -th, col);
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
      tick();
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
          if (b === 0) tick();
          const s = dot3(w, Q[a], Q[b]);
          M[a][b] = s;
          M[b][a] = s;
        }
    } else {
      const Q = thinQ();
      const Gc = opt.G!;
      const cl = opt.clusters!;
      const U: Float64Array[] = Array.from({ length: Gc }, () => new Float64Array(p));
      for (let a = 0; a < p; a++) {
        tick();
        clusterScores(U, cl, e, Q[a], a);
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

// Hot loops live in small helpers: V8 optimises a small function quickly (the lesson of olsInference.ts).
function dot3(w: Float64Array, a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * a[i] * b[i];
  return s;
}

function centreInto(z: Float64Array, c: ArrayLike<number>, m: number): { centred: number; raw: number } {
  let centred = 0;
  let raw = 0;
  for (let i = 0; i < z.length; i++) {
    z[i] = c[i] - m;
    centred += z[i] * z[i];
    raw += c[i] * c[i];
  }
  return { centred, raw };
}

function axpy(y: Float64Array, a: number, x: Float64Array): void {
  for (let i = 0; i < y.length; i++) y[i] += a * x[i];
}

function clusterScores(U: Float64Array[], cl: Int32Array, e: Float64Array, q: Float64Array, a: number): void {
  for (let i = 0; i < e.length; i++) U[cl[i]][a] += e[i] * q[i];
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
  if (p.n * (p.X.length + 1) > PANEL_MAX_CELLS) {
    throw new PanelRefusal(
      `${intText(p.n)} rows × ${p.X.length + 1} coefficients is more than one panel fit handles in the pane (at most ${intText(PANEL_MAX_CELLS)} row-coefficient cells). ` +
        "Use fewer rows, fewer regressors or a shorter event-study window.",
    );
  }
  const ym = magnitudeReason(p.y, p.depName);
  if (ym) throw new PanelRefusal(ym);
  p.X.forEach((c, j) => {
    const m = magnitudeReason(c, p.names[j]);
    if (m) throw new PanelRefusal(m);
    let same = true;
    for (let i = 1; i < c.length && same; i++) if (c[i] !== c[0]) same = false;
    if (same) {
      throw new PanelRefusal(`${q(p.names[j])} is constant (every value is ${numText(c[0])}), so it is perfectly collinear with the constant. Remove it.`);
    }
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

/** Why regressor j counts as absorbed: exactly constant within entities, or below linearmodels' 10⁻⁵ rule. */
function absorbedReason(p: PanelColumns, j: number, ent: Groups, twoway: boolean): string {
  const c = p.X[j];
  const first = new Float64Array(ent.G).fill(NaN);
  let exact = true;
  for (let i = 0; i < p.n && exact; i++) {
    const g = p.entity[i];
    if (Number.isNaN(first[g])) first[g] = c[i];
    else if (first[g] !== c[i]) exact = false;
  }
  const name = q(p.names[j]);
  if (exact) return `${name} does not vary within entities (it is constant for each ${p.entityName}), so the entity effects absorb it. Remove it, or use random effects.`;
  const m = mean(c);
  let dev = 0;
  for (let i = 0; i < p.n; i++) dev = Math.max(dev, Math.abs(c[i] - m));
  const levelHint =
    dev < 1e-2 * Math.abs(m)
      ? ` Its level (about ${fmtFixed(m, 3)}) is large next to its variation: subtracting a constant near its mean from the column leaves the estimate unchanged and passes the check.`
      : "";
  return (
    `${name} has less than 10⁻⁵ of its size left after removing the ${twoway ? "entity and time" : "entity"} effects, so it counts as absorbed ` +
    `(linearmodels' rule for absorbed variables)${twoway ? "; it is (nearly) a sum of an entity part and a period part" : ""}.${levelHint}` +
    (levelHint ? "" : twoway ? " Remove it, or use entity effects only." : " Remove it, or use random effects.")
  );
}

/** Panel fixed effects (linearmodels PanelOLS). */
export function fitFixedEffects(
  p: PanelColumns,
  opts: { effects: "entity" | "twoway"; se: PanelSe; started?: number; skipPooled?: boolean },
): FeResult {
  const started = opts.started ?? Date.now();
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
  // A disconnected panel (groups of entities observed in periods that never overlap): the slopes are identified, and
  // the entity and period dummies have rank N + T − c with c components, so N + T − 1 − c effects beside the constant.
  const ncomp = twoway && p.N > 1 && p.T > 1 ? components(ent, tim).count : 1;
  const neffects = p.N - 1 + (twoway ? p.T - 1 - (ncomp - 1) : 0);
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
    if (!(norm(c) >= ABSORBED_TOL * raw)) throw new PanelRefusal(absorbedReason(p, j, ent, twoway));
  });
  const fit = linFit(yT, XT, p.names, { constant: true, shift: { y: mean(p.y), x: p.X.map(mean) }, started });
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
        ? `Standard errors: clustered by ${c.name} (${intText(c.G)} clusters). The entity effects are nested in the clusters, so they are not counted: factor G/(G − 1)·(n − 1)/(n − k), the xtreg-fe form (linearmodels cov_type="clustered", debiased=True, group_debias=True, which its documentation gives as Stata's xtreg, fe vce(cluster)).`
        : `Standard errors: clustered by ${c.name} (${intText(c.G)} clusters), factor n/(n − k − effects)·G/(G − 1)·(n − 1)/n with all ${intText(neffects)} effects counted, as linearmodels does ${twoway ? "whenever the model has entity and time effects" : "when the entity effects are not nested in the clusters"} (cov_type="clustered", debiased=True, group_debias=True): an areg-style count, not the xtreg-fe form, so the standard errors are larger than a count that leaves out nested effects.`,
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
    if (opts.skipPooled) throw new PanelRefusal("not asked for");
    const pooled = linFit(p.y, p.X, p.names, { constant: true, started });
    const num = (pooled.sse - fit.sse) / neffects;
    const den = fit.sse / dfResid;
    if (neffects <= 0) pooledF = { skipped: "the effects use no degrees of freedom" };
    else if (!(den > 0)) pooledF = { skipped: "the residual sum of squares is 0" };
    else {
      const v = Math.max(num / den, 0);
      pooledF = { value: v, df1: neffects, df2: dfResid, p: fTestP(v, neffects, dfResid) };
    }
  } catch (e) {
    if (!(e instanceof PanelRefusal) || e instanceof PanelTimeout) throw e;
    pooledF = { skipped: opts.skipPooled ? "not computed for this fit" : `the pooled regression cannot be fitted (${e.message})` };
  }
  notes.push(
    twoway
      ? "Entity and time effects, removed exactly (demeaning by the larger dimension and partialling out the other's dummies, as linearmodels' PanelOLS); a constant is estimated with the grand means added back (Stata's _cons)."
      : "Entity effects removed by demeaning each entity; a constant is estimated with the grand means added back (Stata's _cons).",
  );
  if (ncomp > 1) {
    notes.push(
      `The panel splits into ${ncomp} groups of entities observed in periods that never overlap (the entity–period graph is disconnected). ` +
        `The slopes are still identified and are estimated exactly; the entity and time effects are identified only within each group, so the ` +
        `effects counted are N + T − 1 − ${ncomp} = ${intText(neffects)}, the rank of the dummies beside the constant. linearmodels counts N + T − 2 = ` +
        `${intText(p.N + p.T - 2)} whatever the groups, so its residual df is ${intText(ncomp - 1)} lower (${intText(dfResid - (ncomp - 1))}) and its standard errors slightly larger; the slopes agree.`,
    );
  }
  notes.push("Entities with a single row (singletons) are kept, as linearmodels' default singletons=True; they add nothing to the slopes but are counted among the effects.");
  notes.push(
    twoway
      ? "R² (the headline) is the within R², linearmodels' rsquared_within: the entity-demeaned data at the FE coefficients. linearmodels' rsquared, the R² of the fully transformed (entity- and time-demeaned) regression, is also given, with the between R² (entity means) and overall R² (raw data) at the same coefficients."
      : "R² (the headline) is the within R² of the entity-demeaned regression, linearmodels' rsquared (equal to its rsquared_within); between R² (entity means) and overall R² (raw data) are at the same coefficients.",
  );
  if (!opts.skipPooled) notes.push(`The pooled F tests that all ${intText(neffects)} included effects are zero against pooled OLS (linearmodels' f_pooled).`);
  const stats: ModelStat[] = [
    { label: "R²", value: three.w },
    ...(twoway ? [{ label: "R² (two-way transformed)", value: r2 }] : []),
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
export function fitRandomEffects(p: PanelColumns, opts: { se: PanelSe; started?: number }): ReResult {
  const started = opts.started ?? Date.now();
  checkInputs(p);
  const n = p.n;
  const k = p.X.length + 1;
  const ent = makeGroups(p.entity, p.N);
  if (p.N < 2) throw new PanelRefusal("Random effects need at least two entities.");
  // Within regression: σ²ε. Regressors that do not vary within entities have no coefficient there.
  const yd = demean(p.y, ent);
  const Xd = p.X.map((c) => demean(c, ent));
  // linearmodels counts the within regression's numerical rank (lstsq on the demeaned columns divided by their norms
  // before demeaning, rcond = ε·max(n, k)): a column whose demeaned share is at rounding level has no coefficient
  // there, and one that is collinear with the others once demeaned does not add to the rank.
  const rel = Xd.map((c, j) => {
    const raw = norm(p.X[j]);
    if (raw === 0) throw new PanelRefusal(`${q(p.names[j])} is zero in every row used. Remove it.`);
    return norm(c) / raw;
  });
  const relMax = Math.max(...rel);
  const cand: number[] = [];
  rel.forEach((r, j) => {
    if (r > Math.max(n, k) * EPS * Math.max(relMax, Number.MIN_VALUE) * 4) cand.push(j);
  });
  let sseW: number;
  let tv: number[] = [];
  if (cand.length) {
    const w = linFit(yd, cand.map((j) => Xd[j]), cand.map((j) => p.names[j]), { constant: true, shift: { y: 0, x: cand.map(() => 0) }, skipCollinear: true, started });
    sseW = w.sse;
    tv = w.kept.map((r) => cand[r]);
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
  // linearmodels: lstsq on the means, so a regressor collinear with the others in the means (a trend or year dummies
  // on a balanced panel, whose means are the same for every entity) has no coefficient there, and the residual df is
  // N − rank of the between regression.
  const between = linFit(ybar, Xbar, p.names, { constant: true, skipCollinear: true, started });
  const rankB = between.kept.length + 1;
  const droppedB = p.names.filter((_, j) => !between.kept.includes(j));
  const dfB = p.N - rankB;
  if (dfB <= 0) {
    throw new PanelRefusal(
      `σ²ᵤ cannot be estimated: the between regression on ${intText(p.N)} entity means has no residual degrees of freedom ` +
        `(the means of the regressors and the constant have rank ${rankB}, so at least ${rankB + 1} entities are needed).`,
    );
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
  // Quasi-demeaned regression; the constant becomes 1 − θᵢ. The data are first centred on their grand means (an exact
  // reparameterisation: x = m + x_c quasi-demeans to m(1 − θᵢ) + x_c − θᵢx̄_c), so a regressor at a large level is
  // not nearly collinear with the 1 − θᵢ column; the constant is mapped back below.
  const my = mean(p.y);
  const mx = p.X.map(mean);
  const wyc = new Float64Array(n);
  for (let i = 0; i < n; i++) wyc[i] = p.y[i] - my - theta[p.entity[i]] * (ybar[p.entity[i]] - my);
  const wX = p.X.map((c, j) => {
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = c[i] - mx[j] - theta[p.entity[i]] * (Xbar[j][p.entity[i]] - mx[j]);
    return o;
  });
  const wc = new Float64Array(n);
  for (let i = 0; i < n; i++) wc[i] = 1 - theta[p.entity[i]];
  const CONST = "Constant";
  const fitC = linFit(wyc, [...wX, wc], [...p.names, CONST], { constant: false, started });
  const dfResid = n - k;
  if (dfResid <= 0) throw new PanelRefusal(`${intText(n)} rows leave no residual degrees of freedom for ${k} coefficients.`);
  // Back to the user's constant: b₀ = c′ − Σ mⱼbⱼ + m_y, a linear map A on the coefficients.
  const A: number[][] = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => (a === b ? 1 : a === k - 1 ? -mx[b] : 0)));
  const mapV = (W: number[][]): number[][] =>
    A.map((ra) => A.map((rb) => {
      let s = 0;
      for (let a = 0; a < k; a++) {
        if (ra[a] === 0) continue;
        let t = 0;
        for (let b = 0; b < k; b++) t += W[a][b] * rb[b];
        s += ra[a] * t;
      }
      return s;
    }));
  const coefU = fitC.coef.slice();
  for (let j = 0; j < k - 1; j++) coefU[k - 1] -= mx[j] * fitC.coef[j];
  coefU[k - 1] += my;
  const fit = {
    ...fitC,
    coef: coefU,
    vcov: (kind: MeatKind, opt?: { s2Denom?: number; clusters?: Int32Array; G?: number }) => mapV(fitC.vcov(kind, opt)),
  };
  const wy = new Float64Array(n);
  for (let i = 0; i < n; i++) wy[i] = wyc[i] + my * wc[i];
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
      "σ²ᵤ = max(0, SSR_between/(N − rank) − σ²ε/T̄) from the unweighted regression of the entity means (rank = the coefficients that regression estimates), T̄ the harmonic mean of the rows per entity, " +
      "and θᵢ = 1 − √(σ²ε/(Tᵢσ²ᵤ + σ²ε)) for each entity.",
  );
  if (droppedB.length) {
    notes.push(
      `${droppedB.map(q).join(", ")} ${droppedB.length === 1 ? "is" : "are"} collinear with the constant${droppedB.length < k - 1 ? " and the other regressors" : ""} in the entity means ` +
        `(the same mean for every entity, as a trend or year dummies on a balanced panel), so the between regression leaves ${droppedB.length === 1 ? "it" : "them"} out and has rank ${rankB}: ` +
        `σ²ᵤ uses N − ${rankB} = ${intText(dfB)} df, as linearmodels does. ${droppedB.length === 1 ? "It is" : "They are"} still estimated in the GLS regression, from the variation within entities.`,
    );
  }
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

/**
 * Which form of the Hausman statistic was computed:
 *  - "classic": (b_FE − b_RE)ᵀ(V_FE − V_RE)⁻¹(b_FE − b_RE) on the conventional covariances, each with its own s²;
 *  - "sigmamore": Stata's hausman, sigmamore: both covariances on the disturbance variance of the efficient (RE)
 *    estimator, e(rmse)² of xtreg, re (the s² = SSE/(n − k) of the quasi-demeaned GLS regression), so V_FE is
 *    rescaled by s²_RE/s²_FE and V_RE is unchanged;
 *  - "pinv": the sigmamore difference is singular, so the Moore–Penrose inverse is used and df = its rank (Stata's
 *    documented behaviour when the difference is not positive definite).
 */
export type HausmanForm = "classic" | "sigmamore" | "pinv";

export type HausmanResult =
  | { stat: number; df: number; p: number; names: string[]; form: HausmanForm; why: string; s2Fe: number; s2Re: number }
  | { skipped: string };

/** Relative size (to the largest diagonal of the rescaled V_FE) below which an eigenvalue counts as zero. */
export const HAUSMAN_RANK_TOL = 1e-10;
/** Sweeps of the Jacobi eigenvalue method (q ≤ PANEL_MAX_REGRESSORS converges in well under 20). */
const JACOBI_MAX_SWEEPS = 100;

/**
 * Hausman FE vs RE on the regressors both estimate that vary within entities: the classic form when V_FE − V_RE is
 * positive definite; otherwise Stata's sigmamore form; otherwise the Moore–Penrose inverse with df = rank.
 */
export function hausman(fe: FeResult, re: ReResult, started: number = Date.now()): HausmanResult {
  const names = re.timeVarying.filter((nm) => fe.names.includes(nm));
  if (!names.length) return { skipped: "no regressor varies within entities, so fixed effects estimate nothing to compare" };
  const fi = names.map((nm) => fe.names.indexOf(nm));
  const ri = names.map((nm) => re.names.indexOf(nm));
  const q0 = names.length;
  const d = names.map((_, a) => fe.coef[fi[a]] - re.coef[ri[a]]);
  const s2Fe = fe.sse / fe.dfResid;
  const s2Re = re.sse / re.dfResid;
  const diff = (r: number): Float64Array[] => names.map((_, a) => Float64Array.from(names.map((__, b) => r * fe.Vclassical[fi[a]][fi[b]] - re.Vclassical[ri[a]][ri[b]])));
  // Relative tolerance: the difference must be positive definite against the size of V_FE.
  let scale = 0;
  for (let a = 0; a < q0; a++) scale = Math.max(scale, Math.abs(fe.Vclassical[fi[a]][fi[a]]));
  const quad = (L: Float64Array[]): number => {
    const x = cholSolve(L, d);
    let h = 0;
    for (let a = 0; a < q0; a++) h += d[a] * x[a];
    return h;
  };
  const done = (h: number, df: number, form: HausmanForm, why: string): HausmanResult =>
    Number.isFinite(h) ? { stat: h, df, p: chiSquareP(h, df), names, form, why, s2Fe, s2Re } : { skipped: "the Hausman statistic is not a finite number at this scale" };
  const Lc = choleskyRel(diff(1), scale);
  if (Lc) return done(quad(Lc), q0, "classic", "V_FE − V_RE is positive definite, so the classic statistic on the conventional covariances is used");
  if (!(s2Fe > 0) || !(s2Re > 0)) return { skipped: "a residual variance is zero, so the covariances cannot be put on a common σ²" };
  const r = s2Re / s2Fe;
  const S = diff(r);
  const whyNotClassic =
    `V_FE − V_RE is not positive definite on the conventional covariances, because the two fits estimate σ² differently ` +
    `(FE s² = ${fmtFixed(s2Fe, 4)}, RE s² = ${fmtFixed(s2Re, 4)})`;
  const Ls = choleskyRel(S, r * scale);
  if (Ls) {
    return done(quad(Ls), q0, "sigmamore", `${whyNotClassic}; both covariances are put on the efficient (RE) estimator's σ², Stata's sigmamore form, which makes the difference positive definite`);
  }
  // Moore–Penrose inverse of the symmetric difference.
  const eig = jacobiEigen(S, started);
  if (!eig) return { skipped: "the eigenvalues of V_FE − V_RE did not converge" };
  const tol = HAUSMAN_RANK_TOL * r * scale;
  const lmin = Math.min(...eig.values);
  if (lmin < -tol) {
    return {
      skipped:
        "V_FE − V_RE is not positive semi-definite even with both covariances on the RE estimator's σ² (Stata's sigmamore form), so the statistic would be negative: " +
        "these data do not meet the asymptotic assumptions of the Hausman test",
    };
  }
  let h = 0;
  let rank = 0;
  eig.values.forEach((lam, a) => {
    if (lam <= tol) return;
    rank++;
    let vd = 0;
    for (let b = 0; b < q0; b++) vd += eig.vectors[b][a] * d[b];
    h += (vd * vd) / lam;
  });
  if (rank === 0) return { skipped: "V_FE − V_RE is zero to rounding even with a common σ², so the Hausman statistic is not defined" };
  return done(
    h,
    rank,
    "pinv",
    `${whyNotClassic}; on the RE estimator's σ² (Stata's sigmamore form) the difference is singular, rank ${rank} of ${q0}, ` +
      "so the Moore–Penrose generalised inverse is used with df = its rank, as Stata's hausman does",
  );
}

/** Eigenvalues and eigenvectors (columns) of a small symmetric matrix by cyclic Jacobi rotations, or null. */
function jacobiEigen(S0: Float64Array[], started: number): { values: number[]; vectors: number[][] } | null {
  const m = S0.length;
  const A = S0.map((r) => Array.from(r));
  const V: number[][] = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (__, j): number => (i === j ? 1 : 0)));
  let total = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) total += A[i][j] * A[i][j];
  for (let sweep = 0; sweep < JACOBI_MAX_SWEEPS; sweep++) {
    checkClock(started, "Hausman test");
    let off = 0;
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) off += A[i][j] * A[i][j];
    if (!(off > 1e-30 * total)) return { values: A.map((r, i) => r[i]), vectors: V };
    for (let p = 0; p < m; p++)
      for (let qq = p + 1; qq < m; qq++) {
        const apq = A[p][qq];
        if (apq === 0) continue;
        const th = (A[qq][qq] - A[p][p]) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < m; k++) {
          const akp = A[k][p];
          const akq = A[k][qq];
          A[k][p] = c * akp - s * akq;
          A[k][qq] = s * akp + c * akq;
        }
        for (let k = 0; k < m; k++) {
          const apk = A[p][k];
          const aqk = A[qq][k];
          A[p][k] = c * apk - s * aqk;
          A[qq][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < m; k++) {
          const vkp = V[k][p];
          const vkq = V[k][qq];
          V[k][p] = c * vkp - s * vkq;
          V[k][qq] = s * vkp + c * vkq;
        }
      }
  }
  return null;
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
