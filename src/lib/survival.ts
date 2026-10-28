// Survival analysis — Kaplan-Meier, log-rank, and the hazard ratio.
//
// WHY THIS EXISTS
// It was the largest named category missing for a life-science audience. Time-to
// -event data is not analysable by anything else here: a t-test on survival
// times throws away every censored subject, which is usually most of the ones
// who did best.
//
// CENSORING IS THE WHOLE POINT. A subject censored at 10 months is not a subject
// who died at 10 months, and is not a subject who survived forever — they were
// event-free when last seen, and they count toward the risk set up to that
// moment and not after. Every quantity below is built from that one rule, and
// the tests check it by comparing against the uncensored case where the answer
// is known exactly.

import { chiSquareP, normalCdf } from "./stats2";
import { readNumberList } from "./numberList";
import { nbspSeparators } from "./statsDisplay";

export interface SurvivalPoint {
  time: number;
  /** Subjects still at risk immediately before this time. */
  atRisk: number;
  events: number;
  censored: number;
  /** Kaplan-Meier estimate S(t) after this time. */
  survival: number;
  /** Greenwood standard error of S(t). */
  standardError: number;
  /** 95% CI for S(t), log(−log) Greenwood (logLogCI): inside [0, 1] without clipping. */
  ci95: [number, number];
}

export interface KaplanMeierResult {
  ok: boolean;
  reason?: string;
  /** One row per DISTINCT time at which something happened. */
  points: SurvivalPoint[];
  n: number;
  events: number;
  censored: number;
  /**
   * Median survival, or null when the curve never reaches 0.5.
   *
   * "Not reached" is a real and common answer, and reporting the largest
   * observed time instead — as spreadsheets often do — understates survival and
   * looks like data.
   */
  medianSurvival: number | null;
  caveats: string[];
}

/**
 * The 95% interval for S(t) on the log(−log) scale ("exponential Greenwood",
 * Kalbfleisch & Prentice; the default of lifelines and of R survfit's
 * conf.type = "log-log"):
 *   v = Σ d/(r(r−d)) / (ln S)²,  CI = exp(−exp(ln(−ln S) ± z·√v)).
 * It lies inside [0, 1] by construction. The plain S ± 1.96·SE interval it
 * replaces ran past 0 and 1 and had to be CLIPPED, which printed "[0, 0.735]"
 * — a lower bound of exactly zero that no data supports.
 * S = 1 (no event yet) gives [1, 1]; S = 0 gives no interval (NaN).
 */
export function logLogCI(survival: number, greenwood: number): [number, number] {
  if (!Number.isFinite(greenwood) || !(survival > 0)) return [NaN, NaN];
  if (survival >= 1 || greenwood === 0) return [survival, survival];
  const lnS = Math.log(survival);
  const sd = Math.sqrt(greenwood) / Math.abs(lnS);
  const c = Math.log(-lnS);
  const z = 1.959963985;
  return [Math.exp(-Math.exp(c + z * sd)), Math.exp(-Math.exp(c - z * sd))];
}

/** The interval type, stated wherever the interval is printed. */
export const KM_CI_NOTE =
  "95% CI: log(−log) transformed Greenwood interval (as lifelines and R survfit conf.type = \"log-log\"), which stays inside 0 to 1 without clipping.";

/**
 * Kaplan-Meier product-limit estimator.
 *
 * `event[i]` is 1 when the event was observed at `time[i]`, 0 when the subject
 * was censored there.
 */
export function kaplanMeier(times: number[], events: number[]): KaplanMeierResult {
  const empty: KaplanMeierResult = {
    ok: false,
    points: [],
    n: 0,
    events: 0,
    censored: 0,
    medianSurvival: null,
    caveats: [],
  };
  if (!times.length) return { ...empty, reason: "Enter at least one observation." };
  if (times.length !== events.length) {
    return { ...empty, reason: "Every time needs a matching event indicator (1 = event, 0 = censored)." };
  }
  if (times.some((t) => !Number.isFinite(t) || t < 0)) {
    return { ...empty, reason: "Times must be finite and non-negative." };
  }
  if (events.some((e) => e !== 0 && e !== 1)) {
    return { ...empty, reason: "The event indicator must be 1 (event) or 0 (censored)." };
  }
  const n = times.length;
  const order = times.map((t, i) => i).sort((a, b) => times[a] - times[b]);
  const distinct: number[] = [];
  for (const i of order) if (!distinct.length || times[i] !== distinct[distinct.length - 1]) distinct.push(times[i]);

  const points: SurvivalPoint[] = [];
  let survival = 1;
  // Greenwood's variance accumulates sum d/(r(r-d)).
  let greenwood = 0;
  let remaining = n;
  let totalEvents = 0;
  let totalCensored = 0;

  for (const t of distinct) {
    const atRisk = remaining;
    let d = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (times[i] === t) {
        if (events[i] === 1) d++;
        else c++;
      }
    }
    totalEvents += d;
    totalCensored += c;

    if (d > 0 && atRisk > 0) {
      survival *= (atRisk - d) / atRisk;
      if (atRisk - d > 0) greenwood += d / (atRisk * (atRisk - d));
      else greenwood = Infinity; // S(t) hit zero; the variance is undefined beyond
    }
    const se = Number.isFinite(greenwood) ? survival * Math.sqrt(greenwood) : NaN;
    points.push({
      time: t,
      atRisk,
      events: d,
      censored: c,
      survival,
      standardError: se,
      ci95: logLogCI(survival, greenwood),
    });

    // Everyone with this time leaves the risk set — events and censorings alike.
    remaining -= d + c;
  }

  // The first time at which S(t) drops to or below 0.5.
  let median: number | null = null;
  for (const p of points) {
    if (p.survival <= 0.5) {
      median = p.time;
      break;
    }
  }

  const caveats = [
    "Censored subjects (0) are counted as at risk up to their time and not after. They are NOT " +
      "treated as events, and NOT dropped.",
    "The estimate assumes censoring is independent of prognosis. If subjects left the study " +
      "BECAUSE they were doing badly, every number here is optimistic and nothing in the data can " +
      "reveal that.",
  ];
  // A curve that sits EXACTLY at 0.5 over a stretch: packages disagree on its median (bug test R4 #12: this
  // calculator gave 2 where statsmodels gives 3), so the convention is stated rather than left implicit.
  const halfAt = points.findIndex((p) => Math.abs(p.survival - 0.5) <= 1e-12);
  if (median !== null && halfAt >= 0) {
    const next = points.slice(halfAt + 1).find((p) => p.events > 0);
    caveats.push(
      "S(t) is exactly 0.5 from the median time" +
        (next ? ` until the next event time` : " to the end of follow-up") +
        ". Conventions differ for this case: this calculator reports the first time S(t) reaches 0.5; some packages report the end of that flat stretch (statsmodels) or its midpoint.",
    );
  }
  if (median === null) {
    caveats.push(
      "Median survival is NOT REACHED: the curve never falls to 50%. That is a real result — " +
        "reporting the longest observed time in its place would understate survival.",
    );
  }
  if (points.length && points[points.length - 1].survival > 0) {
    caveats.push(
      "The curve ends above zero, so the tail is estimated from few subjects. Confidence intervals " +
        "widen sharply there; treat the right-hand end with caution.",
    );
  }
  // S(t) = 1 IS the right estimate when nobody has had the event, and Greenwood's
  // variance is legitimately zero — but the resulting interval of [1, 1] reads as
  // certainty, which three censored subjects do not buy. The numbers stay (they
  // are correct); the claim they imply is what needs qualifying.
  if (totalEvents === 0) {
    caveats.push(
      "NO EVENTS OCCURRED, so the estimate is S = 1 at every time with a zero-width confidence " +
        "interval. That interval is an artefact of the formula, not evidence: with no events the " +
        "data are consistent with any survival curve above the last follow-up time. Read this as " +
        "\"no events yet in this follow-up\" rather than as a survival estimate.",
    );
  }

  return {
    ok: true,
    points,
    n,
    events: totalEvents,
    censored: totalCensored,
    medianSurvival: median,
    caveats,
  };
}

export interface LogRankResult {
  ok: boolean;
  reason?: string;
  chi2: number;
  df: number;
  p: number;
  /** Observed and expected events per group, in input order. */
  observed: number[];
  expected: number[];
  /**
   * Hazard ratio of group 2 relative to group 1 (two groups only), by the Peto
   * estimator exp((O1−E1)/V). Null for more than two groups, where a single
   * ratio has no meaning.
   */
  hazardRatio: number | null;
  hazardRatioCI: [number, number] | null;
  caveats: string[];
}

/**
 * Log-rank test comparing survival between groups.
 *
 * At each time an event occurs, the events are split between the groups under
 * the null hypothesis in proportion to who is still at risk; the test sums the
 * observed-minus-expected difference over all such times. That is why it uses
 * the whole curve rather than survival at one arbitrary landmark.
 */
export function logRankTest(groups: { times: number[]; events: number[] }[]): LogRankResult {
  const empty: LogRankResult = {
    ok: false,
    chi2: NaN,
    df: NaN,
    p: NaN,
    observed: [],
    expected: [],
    hazardRatio: null,
    hazardRatioCI: null,
    caveats: [],
  };
  const usable = groups.filter((g) => g.times.length > 0);
  if (usable.length < 2) return { ...empty, reason: "Log-rank needs at least two groups." };
  // THE SAME VALIDATION `kaplanMeier` DOES, twenty lines above in this file.
  //
  // This function had none, and the asymmetry inside one file is what makes it an
  // oversight rather than a policy. The damaging case is 1/2 event coding — the
  // SPSS and SAS convention — which reaches here because the pane's list parser
  // filters only NaN. Every `2` was read as "not 1", i.e. censored, so the events
  // were INVERTED and a completely different test was reported with no warning:
  // the same data coded 1/2 gave O = [2, 1], p = 0.487, and coded 0/1 gave
  // O = [3, 3], p = 0.810. Negative times, Infinity and NaN were all accepted
  // with ok:true as well; `kaplanMeier` refuses all four.
  for (const g of usable) {
    if (g.times.length !== g.events.length) {
      return { ...empty, reason: "Every time needs a matching event indicator in each group." };
    }
    if (g.times.some((t) => !Number.isFinite(t) || t < 0)) {
      return { ...empty, reason: "Times must be finite and non-negative." };
    }
    if (g.events.some((e) => e !== 0 && e !== 1)) {
      return {
        ...empty,
        reason:
          "The event indicator must be 1 (event) or 0 (censored). If your data uses 1 = event and " +
          "2 = censored, recode the 2s as 0 — read as-is, every 2 would be treated as censored and " +
          "the comparison would be of different groups than you meant.",
      };
    }
  }

  const k = usable.length;
  const allTimes = new Set<number>();
  for (const g of usable) {
    for (let i = 0; i < g.times.length; i++) if (g.events[i] === 1) allTimes.add(g.times[i]);
  }
  const eventTimes = [...allTimes].sort((a, b) => a - b);
  if (!eventTimes.length) return { ...empty, reason: "No events occurred, so there is nothing to compare." };

  const observed = new Array<number>(k).fill(0);
  const expected = new Array<number>(k).fill(0);
  // Variance of O1−E1, for two groups.
  let variance = 0;
  // The full k×k covariance of O − E (survdiff / lifelines multivariate form):
  // V_jl += d·(n_j/N)·(δ_jl − n_l/N)·(N − d)/(N − 1).
  const cov: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));

  for (const t of eventTimes) {
    const atRisk = usable.map((g) => g.times.reduce((acc, tt) => acc + (tt >= t ? 1 : 0), 0));
    const dEach = usable.map((g) =>
      g.times.reduce((acc, tt, i) => acc + (tt === t && g.events[i] === 1 ? 1 : 0), 0),
    );
    const nTot = atRisk.reduce((a, b) => a + b, 0);
    const dTot = dEach.reduce((a, b) => a + b, 0);
    if (nTot <= 1 || dTot === 0) continue;

    for (let j = 0; j < k; j++) {
      observed[j] += dEach[j];
      expected[j] += (dTot * atRisk[j]) / nTot;
    }
    // Hypergeometric variance for group 1 vs the rest.
    variance +=
      (dTot * (atRisk[0] / nTot) * (1 - atRisk[0] / nTot) * (nTot - dTot)) / (nTot - 1);
    const f = (dTot * (nTot - dTot)) / (nTot - 1);
    for (let j = 0; j < k; j++)
      for (let l = 0; l < k; l++) cov[j][l] += f * (atRisk[j] / nTot) * ((j === l ? 1 : 0) - atRisk[l] / nTot);
  }

  // THE LOG-RANK STATISTIC IS (O1 - E1)^2 / V, NOT sum (Oj - Ej)^2 / Ej.
  //
  // The Pearson form is the wrong denominator: E is the expectation of a sum of
  // hypergeometric draws, and its variance is NOT E. Using it is conservative by
  // roughly 10%, which is more than enough to cross alpha.
  //
  // The variance was already being accumulated above — it was computed for the
  // Peto hazard ratio and then not used for the test it belongs to.
  //
  // Checked against the canonical Freireich 6-MP leukaemia data (Klein &
  // Moeschberger Ex 7.2; the R `survdiff` help page), where the published answer
  // is chi2 = 16.79, p = 4.17e-5. The O and E this function computes already
  // matched the literature exactly — [21, 9] and [10.749, 19.251] — while the
  // statistic came out 15.23, p = 9.5e-5. Only the denominator was wrong.
  //
  // For more than two groups the statistic is the quadratic form
  // (O − E)ᵀ V⁻¹ (O − E) over the first k − 1 groups (V is singular in full,
  // since Σ(O − E) = 0), exactly as R survdiff and lifelines
  // multivariate_logrank_test. It replaced the Pearson approximation
  // Σ(O − E)²/E, which gave 4.58 against lifelines' 5.21 on a 3-group case.
  const df = k - 1;
  let chi2: number;
  if (k === 2) {
    if (!(variance > 0)) return { ...empty, reason: "The log-rank variance is zero (no informative event times), so there is no test." };
    chi2 = (observed[0] - expected[0]) ** 2 / variance;
  } else {
    const m = k - 1;
    const A = cov.slice(0, m).map((row) => row.slice(0, m));
    const b = observed.slice(0, m).map((o, j) => o - expected[j]);
    const x = solveSymmetric(A, b);
    if (!x) {
      return {
        ...empty,
        reason:
          "The covariance of observed − expected events is singular (a group has nobody at risk at any event time), so the k-group test is undefined. Remove that group.",
      };
    }
    chi2 = b.reduce((s, v, j) => s + v * x[j], 0);
  }
  const p = chiSquareP(chi2, df);

  let hazardRatio: number | null = null;
  let hazardRatioCI: [number, number] | null = null;
  if (k === 2 && variance > 0) {
    // Peto estimator. Group 2 relative to group 1: a value above 1 means group 2
    // has the higher hazard, i.e. does worse.
    const logHR = -(observed[0] - expected[0]) / variance;
    const seLog = 1 / Math.sqrt(variance);
    hazardRatio = Math.exp(logHR);
    hazardRatioCI = [Math.exp(logHR - 1.959963985 * seLog), Math.exp(logHR + 1.959963985 * seLog)];
  }

  const caveats = [
    "The log-rank test assumes PROPORTIONAL HAZARDS: that one group's risk stays a constant " +
      "multiple of the other's over time. If the curves cross, it has little power and the result " +
      "can be non-significant when the groups plainly differ.",
    "It tests whether the curves differ, not by how much. Read the hazard ratio or the survival " +
      "estimates for size.",
  ];
  if (hazardRatio !== null) {
    caveats.push(
      "The hazard ratio is Peto's estimator, which is accurate when the ratio is near 1 and biased " +
        "toward 1 when it is extreme. It is not a Cox regression and admits no covariates.",
    );
  }
  if (k > 2) {
    caveats.push(
      `With ${k} groups the test is the global one (df = ${df}): it says the curves are not all the same, not which ` +
        "pair differs. Compare pairs afterwards, with a multiple-comparison correction.",
    );
  }

  return { ok: true, chi2, df, p, observed, expected, hazardRatio, hazardRatioCI, caveats };
}

/** Gaussian elimination with partial pivoting on a small system; null if singular. */
function solveSymmetric(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  const scale = Math.max(...A.map((row) => Math.max(...row.map(Math.abs))), 0);
  if (!(scale > 0)) return null;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) <= 1e-12 * scale) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Points for drawing the step curve, including the initial S=1 at t=0. */
export function survivalCurvePoints(res: KaplanMeierResult): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [{ x: 0, y: 1 }];
  let prev = 1;
  for (const p of res.points) {
    if (p.events === 0) continue; // censoring alone does not step the curve
    pts.push({ x: p.time, y: prev }); // horizontal to the event time
    pts.push({ x: p.time, y: p.survival }); // then the drop
    prev = p.survival;
  }
  // THE CENSORED TAIL. The curve used to stop at the last EVENT, so subjects
  // followed event-free beyond it vanished from the picture — and the length
  // of follow-up is part of what a KM figure reports. It runs flat to the
  // largest observed time.
  const last = res.points.length ? res.points[res.points.length - 1].time : 0;
  if (last > pts[pts.length - 1].x) pts.push({ x: last, y: prev });
  return pts;
}

/**
 * Where to draw the censoring tick marks: one per distinct time at which a
 * subject was censored, at the curve's height there (S after any event at the
 * same time, the right-continuous value).
 */
export function survivalCensorMarks(res: KaplanMeierResult): { x: number; y: number }[] {
  return res.points.filter((p) => p.censored > 0).map((p) => ({ x: p.time, y: p.survival }));
}

/**
 * Typed survival rows ("time event" per line, ";" also ends a line) → arrays.
 * EXACTLY two numbers per row: the pane used to take v[0], v[1] from any row
 * with two or more, so a typed `ID Start Stop Event` row "1 0 5 1" became
 * time = 1 (the ID), event = 0 (the Start) with nothing on screen. A row with
 * three or more numbers is refused by row number, naming the likely layout.
 * Numbers follow the product comma rule (numberList.ts: "12,5 1" is 12.5).
 */
export function readSurvivalRows(text: string): { times: number[]; events: number[] } | { error: string } {
  const times: number[] = [];
  const events: number[] = [];
  const lines = text.split(/[;\n]+/).map((l) => l.trim());
  let row = 0;
  for (const l of lines) {
    if (!l) continue;
    row++;
    const r = readNumberList(nbspSeparators(l));
    if (r.dropped.length) return { error: `Row ${row} ("${l}"): "${r.dropped[0]}" is not a number. Each row is: time, then 1 (event) or 0 (censored).` };
    if (r.values.length !== 2) {
      return {
        error:
          `Row ${row} ("${l}") has ${r.values.length} number${r.values.length === 1 ? "" : "s"}; each row is exactly two: ` +
          "time, then 1 (event) or 0 (censored)." +
          (r.values.length > 2 ? " An id column or start/stop columns must not be typed here — use the table feed, which names them." : ""),
      };
    }
    times.push(r.values[0]);
    events.push(r.values[1]);
  }
  return { times, events };
}

/** Two-sided p for a z, used by the hazard-ratio interval's own reporting. */
export function zToP(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}
