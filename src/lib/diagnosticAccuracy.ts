/**
 * Diagnostic test accuracy (v2.206.0): the 2×2 measures with their intervals, Bayes' rule at a stated prevalence,
 * ROC analysis with the DeLong variance, and the Buderer sample size. Pure functions; the Stats pane glue is
 * clinicalStatCalcs.ts.
 *
 * Conventions (each is printed by the calculator):
 *  - Proportions (sensitivity, specificity, PPV, NPV, accuracy): Wilson score (default) or Clopper–Pearson exact.
 *  - Likelihood ratios: the log method (Simel, Samsa & Matchar 1991, J Clin Epidemiol 44:763): SE of ln LR+ is
 *    √(1/TP − 1/(TP+FN) + 1/FP − 1/(FP+TN)), of ln LR− is √(1/FN − 1/(TP+FN) + 1/TN − 1/(FP+TN)).
 *  - Diagnostic odds ratio: the log (Woolf) method, SE √(1/TP + 1/FP + 1/FN + 1/TN) (Glas et al. 2003, J Clin
 *    Epidemiol 56:1129).
 *  - A zero cell that makes a ratio 0 or infinite: 0.5 is added to every cell (Haldane–Anscombe) for the three ratio
 *    measures only, and the result says so. Proportions are never corrected (their intervals need no correction).
 *  - PPV and NPV at a stated prevalence: Bayes' rule, with the logit interval of Mercaldo, Lau & Zhou (2007, Stat Med
 *    26:2170): var logit PPV = (1 − Se)/(Se·n₁) + Sp/((1 − Sp)·n₀), var logit NPV = Se/((1 − Se)·n₁) + (1 − Sp)/(Sp·n₀).
 *  - ROC: a case is called positive when its score is at or above the cutoff (or at or below it, for "lower = more
 *    likely diseased"). AUC is the Mann–Whitney probability with ties counted one half. Its variance is DeLong,
 *    DeLong & Clarke-Pearson (1988, Biometrics 44:837), computed from midranks (Sun & Xu 2014, IEEE Signal Process
 *    Lett 21:1389); the interval is AUC ± 1.96·SE clipped to [0, 1], as pROC prints it. Two scores on the same cases:
 *    DeLong's paired z test.
 *  - Youden-optimal cutoff: the observed score maximising sensitivity + specificity − 1; among ties, the one with the
 *    higher specificity.
 *  - Buderer (1996, Acad Emerg Med 3:895): n for sensitivity = z²·Se(1 − Se)/(d²·prevalence), for specificity
 *    z²·Sp(1 − Sp)/(d²·(1 − prevalence)); the study needs the larger.
 */
import { propCi, Z975, type PropCiMethod } from "./clinicalCore";
import { normalCdfPrecise } from "./probdist";

export interface Ci {
  est: number;
  lo: number;
  hi: number;
}

export interface Diag2x2 {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  nDiseased: number;
  nHealthy: number;
  n: number;
  sens: Ci;
  spec: Ci;
  ppv: Ci | null;
  npv: Ci | null;
  acc: Ci;
  prevalence: Ci;
  lrPos: Ci;
  lrNeg: Ci;
  dor: Ci;
  youden: number;
  /** True when 0.5 was added to every cell for the ratio measures. */
  haldane: boolean;
  /** The cell(s) that were zero, by name. */
  zeroCells: string[];
}

function logCi(est: number, se: number): Ci {
  return { est, lo: Math.exp(Math.log(est) - Z975 * se), hi: Math.exp(Math.log(est) + Z975 * se) };
}

/** The 2×2 measures. Refuses (by message) a table with no diseased or no healthy subjects. */
export function diag2x2(tp: number, fp: number, fn: number, tn: number, method: PropCiMethod): Diag2x2 | { error: string } {
  const nD = tp + fn;
  const nH = fp + tn;
  if (nD === 0) return { error: "There are no diseased subjects (TP + FN = 0), so sensitivity cannot be estimated." };
  if (nH === 0) return { error: "There are no subjects without the condition (FP + TN = 0), so specificity cannot be estimated." };
  const n = nD + nH;
  const pc = (x: number, m: number): Ci => ({ est: x / m, ...propCi(x, m, method) });
  const sens = pc(tp, nD);
  const spec = pc(tn, nH);
  const ppv = tp + fp > 0 ? pc(tp, tp + fp) : null;
  const npv = fn + tn > 0 ? pc(tn, fn + tn) : null;
  const zeroCells = (
    [
      ["TP", tp],
      ["FP", fp],
      ["FN", fn],
      ["TN", tn],
    ] as [string, number][]
  )
    .filter(([, v]) => v === 0)
    .map(([k]) => k);
  const haldane = zeroCells.length > 0;
  const k = haldane ? 0.5 : 0;
  const [a, b, c, d] = [tp + k, fp + k, fn + k, tn + k];
  const se1 = a / (a + c);
  const sp1 = d / (b + d);
  const lrPos = logCi(se1 / (1 - sp1), Math.sqrt(1 / a - 1 / (a + c) + 1 / b - 1 / (b + d)));
  const lrNeg = logCi((1 - se1) / sp1, Math.sqrt(1 / c - 1 / (a + c) + 1 / d - 1 / (b + d)));
  const dor = logCi((a * d) / (b * c), Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d));
  return {
    tp,
    fp,
    fn,
    tn,
    nDiseased: nD,
    nHealthy: nH,
    n,
    sens,
    spec,
    ppv,
    npv,
    acc: pc(tp + tn, n),
    prevalence: pc(nD, n),
    lrPos,
    lrNeg,
    dor,
    youden: sens.est + spec.est - 1,
    haldane,
    zeroCells,
  };
}

/** PPV and NPV at prevalence p by Bayes' rule (point values). Null where the denominator is zero. */
export function bayesValues(se: number, sp: number, p: number): { ppv: number | null; npv: number | null } {
  const dp = se * p + (1 - sp) * (1 - p);
  const dn = sp * (1 - p) + (1 - se) * p;
  return { ppv: dp > 0 ? (se * p) / dp : null, npv: dn > 0 ? (sp * (1 - p)) / dn : null };
}

/**
 * PPV and NPV at prevalence p with the Mercaldo–Lau–Zhou logit interval, from the 2×2's sensitivity and specificity
 * (n₁ diseased, n₀ healthy). An interval is null when Se or Sp is 0 or 1 (the logit variance is infinite there).
 */
export function bayesWithCi(se: number, sp: number, n1: number, n0: number, p: number): { ppv: Ci | null; npv: Ci | null } {
  const { ppv, npv } = bayesValues(se, sp, p);
  const inside = se > 0 && se < 1 && sp > 0 && sp < 1;
  const expit = (x: number): number => 1 / (1 + Math.exp(-x));
  const wrap = (v: number | null, varLogit: number): Ci | null => {
    if (v === null) return null;
    if (!inside || !(v > 0 && v < 1)) return { est: v, lo: NaN, hi: NaN };
    const l = Math.log(v / (1 - v));
    const s = Math.sqrt(varLogit);
    return { est: v, lo: expit(l - Z975 * s), hi: expit(l + Z975 * s) };
  };
  return {
    ppv: wrap(ppv, (1 - se) / (se * n1) + sp / ((1 - sp) * n0)),
    npv: wrap(npv, se / ((1 - se) * n1) + (1 - sp) / (sp * n0)),
  };
}

/** Post-test probability from a pre-test probability and a likelihood ratio (odds form of Bayes' rule). */
export function postTest(pre: number, lr: number): number {
  const odds = (pre / (1 - pre)) * lr;
  return odds / (1 + odds);
}

// ---------------------------------------------------------------------------------------------------------------
// ROC

export interface RocPoint {
  /** The cutoff: positive when score ≥ cutoff (or ≤, for lower-is-positive). */
  cutoff: number;
  sens: number;
  spec: number;
}

export interface RocFit {
  nPos: number;
  nNeg: number;
  auc: number;
  se: number;
  lo: number;
  hi: number;
  /** DeLong structural components (positives, negatives), kept for the paired test. */
  v10: number[];
  v01: number[];
  /** Curve points from (0, 0) to (1, 1) in FPR order. */
  curve: { fpr: number; tpr: number }[];
  /** Every distinct observed cutoff with its sensitivity and specificity. */
  cuts: RocPoint[];
  best: RocPoint;
  bestJ: number;
}

/** Midranks of xs (1-based), ties averaged. */
export function midranks(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const r = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const m = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) r[idx[t]] = m;
    i = j + 1;
  }
  return r;
}

function sampleVar(v: number[]): number {
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1);
}

function sampleCov(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

/**
 * ROC analysis of scores against 0/1 outcomes. `higherPositive`: a larger score means more likely diseased. Scores are
 * negated internally when lower is positive, so the AUC is always the probability that a diseased case ranks as more
 * abnormal than a healthy one.
 */
export function rocFit(scores: number[], outcome: number[], higherPositive: boolean): RocFit | { error: string } {
  const s = higherPositive ? scores : scores.map((v) => -v);
  const pos: number[] = [];
  const neg: number[] = [];
  outcome.forEach((o, i) => (o === 1 ? pos : neg).push(s[i]));
  const m = pos.length;
  const n = neg.length;
  if (m < 2 || n < 2) return { error: `ROC analysis needs at least two diseased (outcome 1) and two healthy (outcome 0) cases; there are ${m} and ${n}.` };
  const first = s[0];
  if (s.every((v) => v === first)) {
    return { error: "Every score is the same value, so the score cannot separate the groups: the AUC is exactly 0.5 and there is no curve to draw beyond the diagonal." };
  }
  const rAll = midranks([...pos, ...neg]);
  const rPos = midranks(pos);
  const rNeg = midranks(neg);
  const v10 = pos.map((_, i) => (rAll[i] - rPos[i]) / n);
  const v01 = neg.map((_, j) => 1 - (rAll[m + j] - rNeg[j]) / m);
  const auc = v10.reduce((a, b) => a + b, 0) / m;
  const varAuc = sampleVar(v10) / m + sampleVar(v01) / n;
  const se = Math.sqrt(Math.max(0, varAuc));
  // Cutoffs: every distinct score, descending (in the internal orientation).
  const distinct = [...new Set(s)].sort((a, b) => b - a);
  const sortedPos = [...pos].sort((a, b) => b - a);
  const sortedNeg = [...neg].sort((a, b) => b - a);
  const curve: { fpr: number; tpr: number }[] = [{ fpr: 0, tpr: 0 }];
  const cuts: RocPoint[] = [];
  let ip = 0;
  let ineg = 0;
  for (const c of distinct) {
    while (ip < m && sortedPos[ip] >= c) ip++;
    while (ineg < n && sortedNeg[ineg] >= c) ineg++;
    const sens = ip / m;
    const spec = 1 - ineg / n;
    curve.push({ fpr: ineg / n, tpr: sens });
    cuts.push({ cutoff: higherPositive ? c : -c, sens, spec });
  }
  let best = cuts[0];
  let bestJ = -Infinity;
  for (const c of cuts) {
    const j = c.sens + c.spec - 1;
    if (j > bestJ + 1e-12 || (Math.abs(j - bestJ) <= 1e-12 && c.spec > best.spec)) {
      bestJ = j;
      best = c;
    }
  }
  return { nPos: m, nNeg: n, auc, se, lo: Math.max(0, auc - Z975 * se), hi: Math.min(1, auc + Z975 * se), v10, v01, curve, cuts, best, bestJ };
}

/** DeLong's paired test of two AUCs on the same cases (same order of positives and negatives in both fits). */
export function delongPaired(a: RocFit, b: RocFit): { diff: number; se: number; z: number; p: number; lo: number; hi: number; corr: number } {
  const m = a.v10.length;
  const n = a.v01.length;
  const va = sampleVar(a.v10) / m + sampleVar(a.v01) / n;
  const vb = sampleVar(b.v10) / m + sampleVar(b.v01) / n;
  const cov = sampleCov(a.v10, b.v10) / m + sampleCov(a.v01, b.v01) / n;
  const v = va + vb - 2 * cov;
  const diff = a.auc - b.auc;
  const se = Math.sqrt(Math.max(0, v));
  const z = se > 0 ? diff / se : 0;
  const p = se > 0 ? 2 * normalCdfPrecise(-Math.abs(z)) : 1;
  return { diff, se, z, p, lo: diff - Z975 * se, hi: diff + Z975 * se, corr: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN };
}

/** Buderer (1996) sample size for estimating sensitivity and specificity to ±d at prevalence prev. */
export function budererN(se: number, sp: number, prev: number, d: number, z = Z975): { nSens: number; nSpec: number; n: number; diseased: number; healthy: number } {
  const nSens = Math.ceil((z * z * se * (1 - se)) / (d * d * prev) - 1e-9);
  const nSpec = Math.ceil((z * z * sp * (1 - sp)) / (d * d * (1 - prev)) - 1e-9);
  const n = Math.max(nSens, nSpec);
  return { nSens, nSpec, n, diseased: Math.round(n * prev), healthy: Math.round(n * (1 - prev)) };
}
