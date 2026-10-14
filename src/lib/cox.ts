// Cox proportional-hazards regression — the engine behind the Stats `cox`
// calculator (v2.135.0; brief docs/SCOPE-STATS-BATCH.md §B1, §D1, §E5–E6).
//
// WHY THIS EXISTS
// Before this file the only route a survival table had into a "regression" was
// Multiple regression on Time|Status|Age — OLS on censored times with the event
// flag as a predictor, a confident number that answers nothing (§A WRONG 9).
//
// WHAT IT COMPUTES
//   - Partial-likelihood fit by Newton–Raphson from β = 0, Efron ties by default
//     (as R `coxph`), Breslow as an option (as SAS/Stata). Step halving whenever
//     ℓ falls (≤ 10 halvings); iteration cap 30, CHECKED BEFORE each iteration's
//     work; converged when |Δℓ| ≤ 1e-9·|ℓ| (R's eps), with an absolute floor of
//     1e-12 for ℓ ≈ 0. Hitting the cap is a refusal, never "the last iterate".
//   - β, SE, HR = exp(β), Wald 95% CI, Wald z and p; the likelihood-ratio, Wald
//     and score global tests (score uses the information AT β = 0).
//   - Harrell's C with lifelines' pair rule (stated in CONCORDANCE below).
//   - The Grambsch–Therneau proportional-hazards approximation (R survival < 3.0,
//     lifelines) on scaled Schoenfeld residuals, KM time transform, per covariate
//     and global.
//   - The Breslow baseline cumulative hazard at the covariate means, for adjusted
//     survival curves S(t | x) = exp(−H₀(t)·exp((x − x̄)′β)).
//
// NUMERICS (§E5)
// Covariates are centred AND scaled to unit SD inside the fit (β and its
// covariance are transformed back), so a dose in µg or a covariate ×10⁶ gives the
// same z, p and LR. Risk-set sums are accumulated backwards in time with a running
// max-η offset (log-sum-exp), so exp never overflows at β·x ≈ 710. The
// information matrix is factorised by Cholesky; a failed pivot becomes a NAMED
// refusal, never NaN.
//
// REFUSALS ARE THE MAIN DELIVERABLE — every one names what is wrong, never a number:
// size caps (n ≤ 5,000, ≤ 20 parameters, before any work), negative/non-finite
// times, 1/2 event coding (the survival.ts text, verbatim), no events, < 2 events,
// all events at one time, a zero-variance covariate, collinear covariates (named),
// monotone likelihood / separation (named), events per parameter < 10 (Peduzzi
// et al. 1995), a singular information matrix, non-convergence.
//
// Order matters: the cheap structural checks (zero variance, collinearity, the
// monotone-likelihood pre-check) run BEFORE the EPV gate, so a separated 5-event
// table is refused as separated — the true reason — not as "too few events".

import { chiSquareP } from "./stats2";
import { kaplanMeier } from "./survival";
import { leastSquares } from "./regression";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CoxTies = "efron" | "breslow";

/** One numeric covariate column: one value per subject, in subject order. */
export interface CoxCovariate {
  name: string;
  values: number[];
}

/**
 * A categorical covariate that the table feed dummy-coded k−1. `columns` are the
 * names of its indicator covariates (in `covariates`), `levels[i]` is the level
 * that `columns[i]` indicates, and `reference` is the level with all zeros. Used
 * only for labels and for the adjusted-curve profiles; the fit itself sees the
 * indicators as ordinary numeric columns.
 */
export interface CoxFactor {
  name: string;
  reference: string;
  levels: string[];
  columns: string[];
}

/** Input shape. Arrays are parallel: subject i is times[i], events[i], covariates[j].values[i]. */
export interface CoxInput {
  times: number[];
  /** 1 = event, 0 = censored. Anything else is refused (1/2 coding by name). */
  events: number[];
  covariates: CoxCovariate[];
  factors?: CoxFactor[];
}

export interface CoxOptions {
  /** Default "efron" (as R coxph). */
  ties?: CoxTies;
  /**
   * The events-per-parameter gate (≥ 10, Peduzzi et al. 1995). Default true. Turn it
   * off only to test the fitting/separation machinery on small tables.
   */
  epvGate?: boolean;
}

export type CoxRefusalCode =
  | "input"
  | "event-coding"
  | "size"
  | "no-events"
  | "too-few-events"
  | "one-event-time"
  | "zero-variance"
  | "collinear"
  | "separation"
  | "epv"
  | "singular"
  | "nonconvergence";

export interface CoxRefusal {
  ok: false;
  code: CoxRefusalCode;
  reason: string;
  /** The covariates the refusal is about, when it is about specific ones. */
  covariates?: string[];
}

export interface CoxCoefficient {
  name: string;
  beta: number;
  se: number;
  hr: number;
  ciLow: number;
  ciHigh: number;
  z: number;
  p: number;
  /** Sample SD of the covariate (n − 1), used by the separation rule. */
  sd: number;
  mean: number;
  /** The two values, ascending, when the column has exactly two (a 0/1 indicator); else undefined. */
  twoValues?: [number, number];
}

export interface CoxTest {
  statistic: number;
  df: number;
  p: number;
}

export interface CoxPHRow {
  name: string;
  chi2: number;
  df: number;
  p: number;
}

export interface CoxFit {
  ok: true;
  ties: CoxTies;
  n: number;
  events: number;
  parameters: number;
  eventsPerParameter: number;
  coefficients: CoxCoefficient[];
  /** Covariance of β (original units), parameters × parameters. */
  covariance: number[][];
  logLik: number;
  logLikNull: number;
  iterations: number;
  likelihoodRatio: CoxTest;
  wald: CoxTest;
  score: CoxTest;
  concordance: {
    c: number;
    concordant: number;
    discordant: number;
    tiedRisk: number;
    comparable: number;
  };
  phTest: {
    transform: "km";
    rows: CoxPHRow[];
    global: CoxPHRow;
  };
  /** Breslow baseline cumulative hazard at the covariate MEANS, one point per event time. */
  baseline: { time: number; cumHazard: number }[];
  /** Covariate means (the centring point of `baseline`). */
  means: number[];
  names: string[];
  factors: CoxFactor[];
  caveats: string[];
  /** One sentence stating the convergence rule and how many iterations it took. */
  convergence: string;
}

export type CoxResult = CoxFit | CoxRefusal;

// ---------------------------------------------------------------------------
// Limits (all checked before any O(n·p²) work — memory: unbounded loops freeze Word)
// ---------------------------------------------------------------------------

export const COX_MAX_SUBJECTS = 5000;
export const COX_MAX_PARAMETERS = 20;
export const COX_MAX_ITER = 30;
export const COX_MAX_HALVINGS = 10;
export const COX_EPV_MIN = 10;
/**
 * Divergence thresholds on the SD-standardised scale. These REPLACE the brief's
 * §B1 rule (|β|·SD > 10 or SE·SD > 25), which refused strong but finite effects
 * (see divergingRefusal). A large |β|·SD alone now only earns a caveat.
 */
export const COX_SEP_GROWING_BETA_SD = 5;
export const COX_SEP_SE_SD_COLLAPSE = 1e3;
/** |β|·SD above which a FINITE, converged estimate gets the "very strong effect" caveat. */
export const COX_STRONG_BETA_SD = 10;

const Z975 = 1.959963984540054;

/** The survival.ts 1/2-coding text, verbatim (pinned equal to logRankTest's in the tests). */
const EVENT_CODING_REASON =
  "The event indicator must be 1 (event) or 0 (censored). If your data uses 1 = event and " +
  "2 = censored, recode the 2s as 0 — read as-is, every 2 would be treated as censored and " +
  "the comparison would be of different groups than you meant.";

function refuse(code: CoxRefusalCode, reason: string, covariates?: string[]): CoxRefusal {
  return covariates ? { ok: false, code, reason, covariates } : { ok: false, code, reason };
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/** Cholesky of a symmetric p×p (flat, row-major). Returns L or the failing pivot index. */
function cholesky(A: Float64Array, p: number): { L: Float64Array } | { fail: number } {
  const L = new Float64Array(p * p);
  let maxDiag = 0;
  for (let i = 0; i < p; i++) maxDiag = Math.max(maxDiag, Math.abs(A[i * p + i]));
  const tol = 1e-12 * (maxDiag || 1);
  for (let j = 0; j < p; j++) {
    let s = A[j * p + j];
    for (let k = 0; k < j; k++) s -= L[j * p + k] * L[j * p + k];
    if (!(s > tol) || !Number.isFinite(s)) return { fail: j };
    const d = Math.sqrt(s);
    L[j * p + j] = d;
    for (let i = j + 1; i < p; i++) {
      let t = A[i * p + j];
      for (let k = 0; k < j; k++) t -= L[i * p + k] * L[j * p + k];
      L[i * p + j] = t / d;
    }
  }
  return { L };
}

function cholSolve(L: Float64Array, p: number, b: ArrayLike<number>): Float64Array {
  const y = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * p + k] * y[k];
    y[i] = s / L[i * p + i];
  }
  const x = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < p; k++) s -= L[k * p + i] * x[k];
    x[i] = s / L[i * p + i];
  }
  return x;
}

function cholInverse(L: Float64Array, p: number): Float64Array {
  const inv = new Float64Array(p * p);
  const e = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    e.fill(0);
    e[j] = 1;
    const col = cholSolve(L, p, e);
    for (let i = 0; i < p; i++) inv[i * p + j] = col[i];
  }
  // Symmetrise against rounding.
  for (let i = 0; i < p; i++)
    for (let j = i + 1; j < p; j++) {
      const m = 0.5 * (inv[i * p + j] + inv[j * p + i]);
      inv[i * p + j] = m;
      inv[j * p + i] = m;
    }
  return inv;
}

function quad(v: ArrayLike<number>, M: Float64Array, p: number): number {
  let s = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) s += v[i] * M[i * p + j] * v[j];
  return s;
}

/** Plain-number formatting for messages: up to `sig` significant figures, no exponent for ordinary sizes. */
function num(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return "0";
  const a = Math.abs(x);
  let s: string;
  if (a >= 1e-4 && a < 1e15) {
    s = Number(x.toPrecision(sig)).toString();
  } else {
    s = x.toExponential(sig - 1).replace(/e\+?(-?)(\d+)$/, (_m, sgn: string, d: string) => ` × 10${sup(sgn + d)}`);
  }
  return s.replace(/^-/, "−");
}

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻",
};
function sup(s: string): string {
  return s.split("").map((c) => SUP[c] ?? c).join("");
}

/** p for display: "p < 0.0001", else 2 s.f. below 0.01, else 3 decimals. */
export function formatCoxP(p: number): string {
  if (!Number.isFinite(p)) return "p = n/a";
  if (p < 1e-4) return "p < 0.0001";
  if (p < 0.01) return `p = ${Number(p.toPrecision(2)).toString()}`;
  return `p = ${p.toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------

interface Prepared {
  n: number;
  p: number;
  /** Standardised covariates, row-major n×p, in TIME-DESCENDING order. */
  Z: Float64Array;
  /** Events in the same order. */
  E: Uint8Array;
  /** Group boundaries in that order: [start, end) of each block of equal times. */
  groups: [number, number][];
  /** Time of each group. */
  groupTime: number[];
  /** Original index of sorted position k. */
  order: number[];
}

interface Eval {
  ll: number;
  U: Float64Array;
  I: Float64Array;
}

/** Log partial likelihood (and, if `deriv`, the score and information) at γ on the standardised scale. */
function evaluate(P: Prepared, gamma: Float64Array, efron: boolean, deriv: boolean): Eval {
  const { p, Z, E, groups } = P;
  const U = new Float64Array(p);
  const I = new Float64Array(p * p);
  const S1 = new Float64Array(p);
  const S2 = new Float64Array(deriv ? p * p : 0);
  const D1 = new Float64Array(p);
  const D2 = new Float64Array(deriv ? p * p : 0);
  const s1 = new Float64Array(p);
  let S0 = 0;
  let m = -Infinity;
  let ll = 0;
  const eta = new Float64Array(P.n);
  for (let i = 0; i < P.n; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += Z[i * p + j] * gamma[j];
    eta[i] = s;
  }
  for (const [a, b] of groups) {
    let gmax = -Infinity;
    for (let i = a; i < b; i++) if (eta[i] > gmax) gmax = eta[i];
    if (gmax > m) {
      if (Number.isFinite(m)) {
        const f = Math.exp(m - gmax);
        S0 *= f;
        for (let j = 0; j < p; j++) S1[j] *= f;
        if (deriv) for (let k = 0; k < p * p; k++) S2[k] *= f;
      }
      m = gmax;
    }
    let D0 = 0;
    let d = 0;
    D1.fill(0);
    if (deriv) D2.fill(0);
    for (let i = a; i < b; i++) {
      const w = Math.exp(eta[i] - m);
      const zi = i * p;
      S0 += w;
      for (let j = 0; j < p; j++) S1[j] += w * Z[zi + j];
      if (deriv)
        for (let j = 0; j < p; j++) {
          const wz = w * Z[zi + j];
          for (let k = 0; k <= j; k++) S2[j * p + k] += wz * Z[zi + k];
        }
      if (E[i]) {
        d++;
        D0 += w;
        ll += eta[i];
        for (let j = 0; j < p; j++) {
          D1[j] += w * Z[zi + j];
          U[j] += Z[zi + j];
        }
        if (deriv)
          for (let j = 0; j < p; j++) {
            const wz = w * Z[zi + j];
            for (let k = 0; k <= j; k++) D2[j * p + k] += wz * Z[zi + k];
          }
      }
    }
    if (!d) continue;
    for (let l = 0; l < d; l++) {
      const f = efron ? l / d : 0;
      const s0 = S0 - f * D0;
      ll -= Math.log(s0) + m;
      for (let j = 0; j < p; j++) s1[j] = (S1[j] - f * D1[j]) / s0;
      for (let j = 0; j < p; j++) U[j] -= s1[j];
      if (deriv)
        for (let j = 0; j < p; j++)
          for (let k = 0; k <= j; k++) {
            I[j * p + k] += (S2[j * p + k] - f * D2[j * p + k]) / s0 - s1[j] * s1[k];
          }
    }
  }
  if (deriv) for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) I[k * p + j] = I[j * p + k];
  return { ll, U, I };
}

/**
 * Cox proportional-hazards regression.
 *
 * Input: parallel arrays (see {@link CoxInput}); covariates already numeric (the
 * table feed dummy-codes categorical columns k−1 and passes `factors` for labels).
 * Returns a {@link CoxFit} or a {@link CoxRefusal} whose `reason` names the problem.
 */
export function coxRegression(input: CoxInput, opts: CoxOptions = {}): CoxResult {
  const ties: CoxTies = opts.ties ?? "efron";
  if (ties !== "efron" && ties !== "breslow") return refuse("input", `Unknown ties method "${String(ties)}" — use Efron or Breslow.`);
  const efron = ties === "efron";
  const epvGate = opts.epvGate !== false;

  const times = input?.times ?? [];
  const events = input?.events ?? [];
  const covs = input?.covariates ?? [];
  const n = times.length;
  const p = covs.length;

  // ---- shape and size caps: before any work -------------------------------
  if (!n) return refuse("input", "Enter one row per subject: time, event (1/0), then the covariates.");
  if (n > COX_MAX_SUBJECTS)
    return refuse("size", `${n.toLocaleString("en-US")} subjects is above the limit of ${COX_MAX_SUBJECTS.toLocaleString("en-US")} — each Newton step costs n·p², so the calculator stops here rather than freeze Word.`);
  if (!p) return refuse("input", "Cox regression needs at least one covariate column after time and event.");
  if (p > COX_MAX_PARAMETERS)
    return refuse("size", `${p} parameters (after dummy coding) is above the limit of ${COX_MAX_PARAMETERS}.`);
  if (events.length !== n) return refuse("input", "Every time needs a matching event indicator (1 = event, 0 = censored).");
  const names = covs.map((c, j) => (c && typeof c.name === "string" && c.name.trim() ? c.name.trim() : `x${j + 1}`));
  for (let j = 0; j < p; j++) {
    if (!covs[j] || !Array.isArray(covs[j].values) || covs[j].values.length !== n)
      return refuse("input", `Covariate ${names[j]} has ${covs[j]?.values?.length ?? 0} values for ${n} subjects — every subject needs one value per covariate.`, [names[j]]);
  }
  {
    const seen = new Set<string>();
    for (const nm of names) {
      if (seen.has(nm)) return refuse("input", `Two covariates are both named "${nm}" — give each column its own name.`, [nm]);
      seen.add(nm);
    }
  }

  // ---- values ----------------------------------------------------------------
  for (let i = 0; i < n; i++) {
    const t = times[i];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0)
      return refuse("input", `Times must be finite and non-negative — row ${i + 1} has ${describeBad(t, "time")}.`);
  }
  if (events.some((e) => e !== 0 && e !== 1)) return refuse("event-coding", EVENT_CODING_REASON);
  for (let j = 0; j < p; j++) {
    const v = covs[j].values;
    for (let i = 0; i < n; i++)
      if (typeof v[i] !== "number" || !Number.isFinite(v[i]))
        return refuse("input", `${names[j]} has no usable number in row ${i + 1} (${describeBad(v[i], "value")}). Fill it in or remove the row — the calculator does not drop rows silently.`, [names[j]]);
  }

  // ---- events ----------------------------------------------------------------
  let nEvents = 0;
  const eventTimes = new Set<number>();
  for (let i = 0; i < n; i++)
    if (events[i] === 1) {
      nEvents++;
      eventTimes.add(times[i]);
    }
  if (nEvents === 0) return refuse("no-events", "No events occurred (every subject is censored), so there is nothing to model — a Cox fit needs observed events.");
  if (nEvents < 2) return refuse("too-few-events", "Only 1 event occurred. A Cox fit needs at least 2 events (and about 10 per parameter).");
  if (eventTimes.size < 2) {
    const t = [...eventTimes][0];
    return refuse(
      "one-event-time",
      `Every event happened at the same time (t = ${num(t, 6)}), so there is a single risk set and nothing about WHEN subjects fail — Cox regression needs events at two or more distinct times.`,
    );
  }

  // ---- covariate structure: zero variance, collinearity -----------------------
  const means = new Array<number>(p).fill(0);
  const sds = new Array<number>(p).fill(0);
  for (let j = 0; j < p; j++) {
    const v = covs[j].values;
    let s = 0;
    for (let i = 0; i < n; i++) s += v[i];
    const mu = s / n;
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (v[i] - mu) * (v[i] - mu);
    means[j] = mu;
    sds[j] = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    // Relative test: a column of 1e6 + tiny rounding is still constant.
    const scale = Math.max(Math.abs(mu), 1e-300);
    if (!(sds[j] > 1e-13 * scale) || n < 2)
      return refuse("zero-variance", `${names[j]} has the same value (${num(v[0], 6)}) for every subject, so its effect cannot be estimated — remove the column.`, [names[j]]);
  }
  const Zorig: number[][] = [];
  for (let j = 0; j < p; j++) Zorig.push(covs[j].values.map((x) => (x - means[j]) / sds[j]));
  const collinear = findCollinear(Zorig, names, sds, means, covs);
  if (collinear) return collinear;

  // ---- a factor level with no events (names the LEVEL, reference included) -----
  const lvl = factorLevelPrecheck(times, events, covs, names, input.factors ?? []);
  if (lvl) return lvl;

  // ---- monotone likelihood pre-check (per covariate, sound for any type) -------
  const sep = monotonePrecheck(times, events, covs, names);
  if (sep) return sep;

  // ---- EPV ------------------------------------------------------------------
  const epv = nEvents / p;
  if (epvGate && epv < COX_EPV_MIN) {
    return refuse(
      "epv",
      `${nEvents} events for ${p} parameter${p === 1 ? "" : "s"} (${epv.toFixed(1)} per parameter); Cox estimates need about ${COX_EPV_MIN} events per parameter — drop covariates or collect more events.`,
    );
  }

  // ---- prepare: sort by time DESCENDING (risk sets accumulate backwards) -------
  // Subjects tied at one time form one block: all of them join the risk set
  // before that time's deaths are processed, which is R's "deaths before
  // censorings at equal times" convention (a subject censored at t is at risk at t).
  const order = times.map((_, i) => i).sort((a, b) => times[b] - times[a] || a - b);
  const Z = new Float64Array(n * p);
  const Ev = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    Ev[k] = events[i];
    for (let j = 0; j < p; j++) Z[k * p + j] = Zorig[j][i];
  }
  const groups: [number, number][] = [];
  const groupTime: number[] = [];
  for (let k = 0; k < n; ) {
    let e = k + 1;
    while (e < n && times[order[e]] === times[order[k]]) e++;
    groups.push([k, e]);
    groupTime.push(times[order[k]]);
    k = e;
  }
  const P: Prepared = { n, p, Z, E: Ev, groups, groupTime, order };

  // ---- Newton–Raphson -----------------------------------------------------------
  let gamma: Float64Array = new Float64Array(p);
  let cur =evaluate(P, gamma, efron, true);
  const ll0 = cur.ll;
  const U0 = cur.U;
  const I0 = cur.I;
  let iter = 0;
  let converged = false;
  let stalled = false;
  let lastStep: Float64Array | null = null;
  for (;;) {
    if (iter >= COX_MAX_ITER) break; // cap checked BEFORE the iteration's work
    iter++;
    const ch = cholesky(cur.I, p);
    if ("fail" in ch) {
      // A diverging coefficient drives its information toward 0 — that is
      // separation, not collinearity; say which.
      const div = iter > 1 ? divergingRefusal(gamma, null, names, lastStep) : null;
      return div ?? singularRefusal(names[ch.fail], names);
    }
    const delta = cholSolve(ch.L, p, cur.U);
    let step = 1;
    let next: Float64Array | null = null;
    let nextLl = NaN;
    const slack = 1e-12 * Math.max(1, Math.abs(cur.ll));
    for (let h = 0; h <= COX_MAX_HALVINGS; h++) {
      const cand = new Float64Array(p);
      for (let j = 0; j < p; j++) cand[j] = gamma[j] + step * delta[j];
      const e = evaluate(P, cand, efron, false);
      if (Number.isFinite(e.ll) && e.ll >= cur.ll - slack) {
        next = cand;
        nextLl = e.ll;
        break;
      }
      step /= 2;
    }
    if (!next) {
      // No step raises ℓ: either we sit on the optimum to rounding (the predicted
      // gain U′δ/2 is negligible) or the surface is pathological — refuse then.
      let gain = 0;
      for (let j = 0; j < p; j++) gain += cur.U[j] * delta[j];
      if (Math.abs(gain) / 2 <= 1e-9 * Math.max(Math.abs(cur.ll), 1e-3)) {
        converged = true;
        break;
      }
      stalled = true;
      break;
    }
    const dl = nextLl - cur.ll;
    lastStep = new Float64Array(p);
    for (let j = 0; j < p; j++) lastStep[j] = next[j] - gamma[j];
    gamma = next;
    cur = evaluate(P, gamma, efron, true);
    if (Math.abs(dl) <= 1e-9 * Math.abs(cur.ll) || Math.abs(dl) <= 1e-12) {
      converged = true;
      break;
    }
  }

  // ---- separation (post-fit, also at the cap) ------------------------------------
  const chFinal = cholesky(cur.I, p);
  let Vg: Float64Array | null = null;
  let nextStep: Float64Array | null = null;
  if (!("fail" in chFinal)) {
    Vg = cholInverse(chFinal.L, p);
    nextStep = cholSolve(chFinal.L, p, cur.U); // where Newton would go next
  }
  {
    const div = divergingRefusal(gamma, Vg, names, Vg ? nextStep : lastStep);
    if (div) return div;
  }
  if (!converged) {
    return refuse(
      "nonconvergence",
      stalled
        ? `The fit stopped improving before converging (no step-halved Newton step raised the likelihood after ${iter} iterations). No estimate is reported.`
        : `The fit did not converge in ${COX_MAX_ITER} Newton–Raphson iterations (criterion |Δℓ| ≤ 10⁻⁹·|ℓ|). No estimate is reported — the last iterate is not an answer.`,
    );
  }
  if ("fail" in chFinal || !Vg) return singularRefusal(names[(chFinal as { fail: number }).fail], names);

  // ---- coefficients in original units ---------------------------------------------
  const coefficients: CoxCoefficient[] = [];
  const covariance: number[][] = [];
  for (let i = 0; i < p; i++) {
    const row: number[] = [];
    for (let j = 0; j < p; j++) row.push(Vg[i * p + j] / (sds[i] * sds[j]));
    covariance.push(row);
  }
  for (let j = 0; j < p; j++) {
    const beta = gamma[j] / sds[j];
    const se = Math.sqrt(Vg[j * p + j]) / sds[j];
    const z = gamma[j] / Math.sqrt(Vg[j * p + j]);
    coefficients.push({
      name: names[j],
      beta,
      se,
      hr: Math.exp(beta),
      ciLow: Math.exp(beta - Z975 * se),
      ciHigh: Math.exp(beta + Z975 * se),
      z,
      p: chiSquareP(z * z, 1),
      sd: sds[j],
      mean: means[j],
      ...twoValuesOf(covs[j].values),
    });
  }

  // ---- global tests -----------------------------------------------------------------
  const lr = Math.max(0, 2 * (cur.ll - ll0));
  const waldStat = quad(gamma, cur.I, p);
  const ch0 = cholesky(I0, p);
  const scoreStat = "fail" in ch0 ? NaN : quad(U0, cholInverse(ch0.L, p), p);

  // ---- concordance, PH test, baseline -----------------------------------------------
  const etaOrig = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += Zorig[j][i] * gamma[j];
    etaOrig[i] = s;
  }
  const concordance = harrellC(times, events, etaOrig);
  const ph = phTest(P, gamma, Vg, efron, times, events, names);
  const baseline = breslowBaseline(P, gamma);

  const factors = (input.factors ?? []).filter((f) => f && Array.isArray(f.columns));
  const caveats: string[] = [
    efron
      ? "Tied event times handled by Efron's method (as R coxph). Breslow (the SAS/Stata default) gives slightly different estimates when times are tied."
      : "Tied event times handled by Breslow's method (as the SAS/Stata default). Efron (R's default) gives slightly different estimates when times are tied.",
    "Confidence intervals are Wald intervals, exp(β ± 1.96·SE); profile-likelihood intervals are not computed.",
    "Concordance (Harrell's C) measures ranking only — whether higher-risk subjects fail first — not calibration.",
    "A log-rank calculator's hazard ratio (Peto's estimator) differs from the Cox hazard ratio by design; neither is wrong.",
    "Proportional-hazards check: the Grambsch–Therneau approximation on scaled Schoenfeld residuals with the Kaplan–Meier time transform (as R survival < 3.0 and lifelines); R ≥ 3.0 cox.zph computes a different statistic.",
    "Not supported: time-varying covariates, strata, frailty, interactions, splines, competing risks.",
  ];
  for (let j = 0; j < p; j++)
    if (Math.abs(gamma[j]) > COX_STRONG_BETA_SD)
      caveats.push(
        `${names[j]}: a very strong effect (β × SD = ${num(gamma[j], 3)}) — the estimate is finite (the fit converged, SE × SD = ${num(Math.sqrt(Vg[j * p + j]), 3)}) but imprecise; check for near-separation.`,
      );
  for (const r of ph.rows)
    if (r.p < 0.05)
      caveats.push(`${r.name}: χ²(1) = ${num(r.chi2, 4)}, ${formatCoxP(r.p)} — the effect of ${r.name} changes over time; its single HR is an average.`);

  return {
    ok: true,
    ties,
    n,
    events: nEvents,
    parameters: p,
    eventsPerParameter: epv,
    coefficients,
    covariance,
    logLik: cur.ll,
    logLikNull: ll0,
    iterations: iter,
    likelihoodRatio: { statistic: lr, df: p, p: chiSquareP(lr, p) },
    wald: { statistic: waldStat, df: p, p: chiSquareP(waldStat, p) },
    score: { statistic: scoreStat, df: p, p: Number.isFinite(scoreStat) ? chiSquareP(scoreStat, p) : NaN },
    concordance,
    phTest: ph,
    baseline,
    means,
    names,
    factors,
    caveats,
    convergence: `Newton–Raphson from β = 0 with step halving; converged in ${iter} iteration${iter === 1 ? "" : "s"} (|Δℓ| ≤ 10⁻⁹·|ℓ|; cap ${COX_MAX_ITER}).`,
  };
}

/**
 * Divergence (monotone likelihood) detected from the FIT, not from the size of β.
 *
 * DEFECT FIXED (independent review, stats.review.test.ts): the §B1 rule
 * "|β|·SD > 10 or SE·SD > 25" refused strong but FINITE effects — n = 60 with
 * β = 16.106 (SE 2.514, z = 6.4; statsmodels and lifelines agree) was told "no
 * finite hazard ratio exists". A big |β| is not divergence. Divergence is: the
 * likelihood still wants to move that coefficient OUTWARD by a non-vanishing
 * Newton step while ℓ gains vanish (on a monotone likelihood each Newton step
 * adds ≈ 1 to β·SD forever, whereas a converged fit's next step is ~0), AND/OR
 * the information along it has collapsed (SE·SD > 10³; a truly divergent fit
 * shows thousands). `step` is the next Newton step on the standardised scale
 * (null when the information could not be factorised, then a collapsed Hessian
 * plus a large, still-growing |β|·SD is the signal).
 */
function divergingRefusal(
  gamma: Float64Array,
  Vg: Float64Array | null,
  names: string[],
  step: Float64Array | null,
): CoxRefusal | null {
  const p = gamma.length;
  let worst = -1;
  let worstScore = 0;
  for (let j = 0; j < p; j++) {
    const bsd = Math.abs(gamma[j]);
    let diverging: boolean;
    let sesd = NaN;
    if (!Number.isFinite(bsd)) diverging = true;
    else if (!Vg || !step) {
      // Information not factorisable mid-fit: a collapsed Hessian with a large,
      // still-growing coefficient is divergence; at small β it is collinearity.
      diverging = bsd > COX_SEP_GROWING_BETA_SD && (!step || Math.abs(step[j]) > 0.25);
    } else {
      sesd = Math.sqrt(Math.max(Vg[j * p + j], 0));
      const outward = Math.sign(step[j]) === Math.sign(gamma[j]);
      diverging =
        !Number.isFinite(sesd) ||
        sesd > COX_SEP_SE_SD_COLLAPSE * 10 ||
        (bsd > COX_SEP_GROWING_BETA_SD && outward && (sesd > COX_SEP_SE_SD_COLLAPSE || Math.abs(step[j]) > 0.5));
    }
    if (diverging) {
      const score = Number.isFinite(bsd) ? bsd + (Number.isFinite(sesd) ? Math.log(sesd) : 50) : Infinity;
      if (worst < 0 || score > worstScore) {
        worst = j;
        worstScore = score;
      }
    }
  }
  if (worst < 0) return null;
  const j = worst;
  const sesd = Vg ? Math.sqrt(Math.max(Vg[j * p + j], 0)) : NaN;
  return refuse(
    "separation",
    `The estimate for ${names[j]} is diverging (β × SD = ${num(gamma[j], 3)}${Number.isFinite(sesd) ? `, SE × SD = ${num(sesd, 3)}` : ""}): the likelihood keeps rising as its coefficient grows (monotone likelihood — usually some combination of covariates predicts exactly who has the event and when), so no finite hazard ratio exists. Remove or merge the covariate, or collect more data.`,
    [names[j]],
  );
}

/**
 * A level of a dummy-coded factor with NO events while its subjects were at risk
 * is separation for that factor. For a non-reference level the indicator column
 * alone would also trip the monotone pre-check, but for the REFERENCE level no
 * single column does — the fit diverges in all indicators at once, and the
 * post-fit message used to name whichever indicator was largest ("III") instead
 * of the event-free level. This names the level.
 */
function factorLevelPrecheck(
  times: number[],
  events: number[],
  covs: CoxCovariate[],
  names: string[],
  factors: CoxFactor[],
): CoxRefusal | null {
  const n = times.length;
  let firstEvent = Infinity;
  for (let i = 0; i < n; i++) if (events[i] === 1 && times[i] < firstEvent) firstEvent = times[i];
  for (const f of factors) {
    if (!f || !Array.isArray(f.columns) || !f.columns.length) continue;
    const cols = f.columns.map((c) => names.indexOf(c));
    if (cols.some((c) => c < 0)) continue;
    const levelOf = (i: number): number => {
      for (let k = 0; k < cols.length; k++) if (covs[cols[k]].values[i] === 1) return k;
      return -1; // reference
    };
    const evCount = new Map<number, number>();
    const atRisk = new Map<number, boolean>();
    for (let i = 0; i < n; i++) {
      const L = levelOf(i);
      evCount.set(L, (evCount.get(L) ?? 0) + (events[i] === 1 ? 1 : 0));
      if (times[i] >= firstEvent) atRisk.set(L, true);
    }
    for (const L of [-1, ...cols.map((_, k) => k)]) {
      if (!atRisk.get(L) || (evCount.get(L) ?? 0) > 0) continue;
      const label = L < 0 ? f.reference : f.levels[L];
      const others = L < 0 ? f.levels : [f.reference, ...f.levels.filter((_, k) => k !== L)];
      return refuse(
        "separation",
        L < 0
          ? `No events occurred in ${f.name} ${label}, the reference level, so the hazard ratio of every other ${f.name} level (${listAnd(others)}) against ${label} is infinite — no finite estimate exists. Choose a reference level that has events, or merge ${label} with another level.`
          : `No events occurred in ${f.name} ${label}, so its hazard ratio against ${f.reference} is zero — no finite estimate exists. Merge ${label} with a neighbouring level.`,
        L < 0 ? [...f.columns] : [f.columns[L]],
      );
    }
  }
  return null;
}

function twoValuesOf(v: number[]): { twoValues?: [number, number] } {
  const a = v[0];
  let b: number | undefined;
  for (const x of v) {
    if (x === a) continue;
    if (b === undefined) b = x;
    else if (x !== b) return {};
  }
  return b === undefined ? {} : { twoValues: a < b ? [a, b] : [b, a] };
}

/** Words for a bad cell — never echo "NaN"/"Infinity" into user text. */
function describeBad(v: unknown, what: string): string {
  if (typeof v === "number") {
    if (Number.isNaN(v)) return `a ${what} that is not a number`;
    if (!Number.isFinite(v)) return `an infinite ${what}`;
    return `${what} ${num(v, 6)}`;
  }
  if (v == null || v === "") return `a blank ${what}`;
  return `the text "${String(v).slice(0, 20)}"`;
}

function singularRefusal(name: string | undefined, names: string[]): CoxRefusal {
  const nm = name ?? names[0];
  return refuse(
    "singular",
    `The information matrix is singular at ${nm}: within the risk sets at the event times, ${nm} carries no information separate from the other covariates (it does not vary among the subjects still at risk, or it is a combination of other columns there). Remove ${nm} or the covariates it duplicates.`,
    [nm],
  );
}

// ---------------------------------------------------------------------------
// Collinearity: modified Gram–Schmidt on the standardised columns
// ---------------------------------------------------------------------------

function findCollinear(
  Z: number[][],
  names: string[],
  sds: number[],
  means: number[],
  covs: CoxCovariate[],
): CoxRefusal | null {
  const p = Z.length;
  const n = Z[0]?.length ?? 0;
  const basis: Float64Array[] = [];
  const accepted: number[] = [];
  for (let j = 0; j < p; j++) {
    const v = Float64Array.from(Z[j]);
    const norm0 = v.reduce((s, x) => s + x * x, 0);
    for (const q of basis) {
      let d = 0;
      for (let i = 0; i < n; i++) d += q[i] * v[i];
      for (let i = 0; i < n; i++) v[i] -= d * q[i];
    }
    const norm = v.reduce((s, x) => s + x * x, 0);
    if (norm <= 1e-10 * norm0) {
      // Which earlier columns does it depend on? Least squares of z_j on them.
      const X = Array.from({ length: n }, (_, i) => accepted.map((k) => Z[k][i]));
      const fit = accepted.length ? leastSquares(X, Z[j]) : null;
      const involved: { k: number; c: number }[] = [];
      if (fit) fit.beta.forEach((c, idx) => Math.abs(c) > 1e-6 && involved.push({ k: accepted[idx], c }));
      const others = involved.map((t) => names[t.k]);
      if (involved.length === 1) {
        const k = involved[0].k;
        const b = (involved[0].c * sds[j]) / sds[k];
        const a = means[j] - b * means[k];
        void covs;
        return refuse(
          "collinear",
          `${names[j]} and ${names[k]} are collinear (${names[j]} = ${num(b, 6)} × ${names[k]}${Math.abs(a) > 1e-9 * Math.max(1, Math.abs(means[j])) ? ` ${a < 0 ? "−" : "+"} ${num(Math.abs(a), 6)}` : ""}), so the model cannot separate their effects — remove one of them.`,
          [names[j], names[k]],
        );
      }
      return refuse(
        "collinear",
        `${names[j]} is an exact linear combination of ${listAnd(others.length ? others : names.filter((_, k) => k < j))}, so the model cannot separate their effects — remove one of them. (For indicator columns: one level must be left out as the reference.)`,
        [names[j], ...others],
      );
    }
    const s = Math.sqrt(norm);
    for (let i = 0; i < n; i++) v[i] /= s;
    basis.push(v);
    accepted.push(j);
  }
  return null;
}

function listAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Monotone likelihood pre-check
// ---------------------------------------------------------------------------
//
// For one covariate x: if at EVERY event time each subject who has the event holds
// the largest x of everyone still at risk (strictly larger than someone at least
// once), every term of ℓ is non-decreasing in β_x, whatever the other coefficients
// are — ℓ has its supremum at β_x → +∞ and no finite estimate exists. Same with
// "smallest" and −∞. Sound for any covariate type and any other covariates; it
// catches the one-covariate cases exactly, and the post-fit bound catches
// combinations.

function monotonePrecheck(times: number[], events: number[], covs: CoxCovariate[], names: string[]): CoxRefusal | null {
  const n = times.length;
  const order = times.map((_, i) => i).sort((a, b) => times[b] - times[a] || a - b);
  for (let j = 0; j < covs.length; j++) {
    const x = covs[j].values;
    let allMax = true;
    let allMin = true;
    let strictMax = false;
    let strictMin = false;
    let rMax = -Infinity;
    let rMin = Infinity;
    for (let k = 0; k < n && (allMax || allMin); ) {
      let e = k + 1;
      while (e < n && times[order[e]] === times[order[k]]) e++;
      for (let q = k; q < e; q++) {
        const v = x[order[q]];
        if (v > rMax) rMax = v;
        if (v < rMin) rMin = v;
      }
      for (let q = k; q < e; q++) {
        const i = order[q];
        if (events[i] !== 1) continue;
        if (x[i] < rMax) allMax = false;
        if (x[i] > rMin) allMin = false;
        if (x[i] > rMin) strictMax = true;
        if (x[i] < rMax) strictMin = true;
      }
      k = e;
    }
    const up = allMax && strictMax;
    const down = allMin && strictMin;
    if (up || down) {
      const values = [...new Set(x)].sort((a, b) => a - b);
      const binary = values.length === 2;
      const extreme = up ? values[values.length - 1] : values[0];
      const other = up ? values[0] : values[values.length - 1];
      // "Every event occurred with x = 1" only when it is literally true. A RARE
      // level (one subject with x = 1 who failed first, everyone else x = 0)
      // satisfies the monotone condition too — the later deaths trivially hold
      // the risk-set extreme once that subject is gone — and there the sentence
      // would be false.
      let allAtExtreme = true;
      for (let i = 0; i < n; i++) if (events[i] === 1 && x[i] !== extreme) allAtExtreme = false;
      let what: string;
      if (binary && allAtExtreme) {
        what = `every event occurred with ${names[j]} = ${num(extreme, 6)} while subjects with ${names[j]} = ${num(other, 6)} were still at risk`;
      } else {
        what = `at every event time the subjects who had the event held the ${up ? "highest" : "lowest"} ${names[j]} of everyone still at risk`;
        if (binary) {
          const k = x.filter((v) => v === extreme).length;
          if (k <= n / 2)
            what += ` (${names[j]} = ${num(extreme, 6)} is held by only ${k} subject${k === 1 ? "" : "s"}, and no one with ${names[j]} = ${num(other, 6)} had an event while ${k === 1 ? "that subject was" : "any of them was"} still at risk — merge this rare level with another)`;
        }
      }
      return refuse(
        "separation",
        `${what[0].toUpperCase()}${what.slice(1)}, so the hazard ratio for ${names[j]} is ${up ? "infinite" : "zero"} — no finite estimate exists (monotone likelihood / separation). Programs that print a number here are printing where their iterations stopped.`,
        [names[j]],
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Concordance — Harrell's C with lifelines' pair rule
// ---------------------------------------------------------------------------
//
// A pair (a, b) is comparable when the earlier time is an event; at EQUAL times
// only when exactly one of the two is an event (that one should be the riskier).
// Concordant when the subject who failed first has the higher risk score
// η = x′β; equal risk scores count ½. (lifelines `concordance_index`; check R's
// `concordance()` before claiming agreement — §C.)

function harrellC(times: number[], events: number[], eta: Float64Array) {
  const n = times.length;
  let concordant = 0;
  let discordant = 0;
  let tiedRisk = 0;
  let comparable = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      let first: number;
      let second: number;
      if (times[a] === times[b]) {
        if (events[a] === events[b]) continue;
        first = events[a] === 1 ? a : b;
        second = first === a ? b : a;
      } else {
        first = times[a] < times[b] ? a : b;
        second = first === a ? b : a;
        if (events[first] !== 1) continue;
      }
      comparable++;
      if (eta[first] > eta[second]) concordant++;
      else if (eta[first] < eta[second]) discordant++;
      else tiedRisk++;
    }
  }
  return { c: comparable ? (concordant + 0.5 * tiedRisk) / comparable : NaN, concordant, discordant, tiedRisk, comparable };
}

// ---------------------------------------------------------------------------
// Proportional-hazards check (Grambsch–Therneau approximation, KM transform)
// ---------------------------------------------------------------------------
//
// Schoenfeld residual of an event subject: s = x − x̄(t), where x̄(t) is the
// risk-weighted mean — Efron-averaged over the tied deaths, Σₗ (S₁ − (l/d)·D₁) /
// (S₀ − (l/d)·D₀) / d, as lifelines; S₁/S₀ under Breslow. Scaled: s* = d·s·V.
// With g = 1 − S_KM(t) per event (right-continuous, tied events repeat their g),
// centred over the events:
//   per covariate  T_j = (Σ g̃ s*_j)² / (d · V_jj · Σ g̃²)
//   global         T   = d · u′ V u / Σ g̃²,   u = Σ g̃ s   (unscaled)
// Both are invariant to the covariate scaling, so they are computed on the
// standardised scale.

function phTest(
  P: Prepared,
  gamma: Float64Array,
  V: Float64Array,
  efron: boolean,
  times: number[],
  events: number[],
  names: string[],
): CoxFit["phTest"] {
  const { p, Z, E, groups, n } = P;
  const km = kaplanMeier(times, events);
  const kmAt = new Map<number, number>();
  for (const pt of km.points) kmAt.set(pt.time, pt.survival);

  const eta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += Z[i * p + j] * gamma[j];
    eta[i] = s;
  }
  const resid: Float64Array[] = [];
  const g: number[] = [];
  const S1 = new Float64Array(p);
  const D1 = new Float64Array(p);
  const mean = new Float64Array(p);
  let S0 = 0;
  let m = -Infinity;
  for (let gi = 0; gi < groups.length; gi++) {
    const [a, b] = groups[gi];
    let gmax = -Infinity;
    for (let i = a; i < b; i++) if (eta[i] > gmax) gmax = eta[i];
    if (gmax > m) {
      if (Number.isFinite(m)) {
        const f = Math.exp(m - gmax);
        S0 *= f;
        for (let j = 0; j < p; j++) S1[j] *= f;
      }
      m = gmax;
    }
    let D0 = 0;
    let d = 0;
    D1.fill(0);
    for (let i = a; i < b; i++) {
      const w = Math.exp(eta[i] - m);
      S0 += w;
      for (let j = 0; j < p; j++) S1[j] += w * Z[i * p + j];
      if (E[i]) {
        d++;
        D0 += w;
        for (let j = 0; j < p; j++) D1[j] += w * Z[i * p + j];
      }
    }
    if (!d) continue;
    mean.fill(0);
    if (efron) {
      for (let l = 0; l < d; l++) {
        const f = l / d;
        const s0 = S0 - f * D0;
        for (let j = 0; j < p; j++) mean[j] += (S1[j] - f * D1[j]) / s0 / d;
      }
    } else {
      for (let j = 0; j < p; j++) mean[j] = S1[j] / S0;
    }
    const gt = 1 - (kmAt.get(P.groupTime[gi]) ?? 1);
    for (let i = a; i < b; i++) {
      if (!E[i]) continue;
      const r = new Float64Array(p);
      for (let j = 0; j < p; j++) r[j] = Z[i * p + j] - mean[j];
      resid.push(r);
      g.push(gt);
    }
  }
  const dTot = g.length;
  const gBar = g.reduce((s, x) => s + x, 0) / dTot;
  const gt = g.map((x) => x - gBar);
  const sumG2 = gt.reduce((s, x) => s + x * x, 0);
  const u = new Float64Array(p);
  for (let k = 0; k < dTot; k++) for (let j = 0; j < p; j++) u[j] += gt[k] * resid[k][j];
  const Vu = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += V[i * p + j] * u[j];
    Vu[i] = s;
  }
  const rows: CoxPHRow[] = [];
  for (let j = 0; j < p; j++) {
    const chi2 = sumG2 > 0 ? (dTot * Vu[j] * Vu[j]) / (V[j * p + j] * sumG2) : NaN;
    rows.push({ name: names[j], chi2, df: 1, p: Number.isFinite(chi2) ? chiSquareP(chi2, 1) : NaN });
  }
  let uVu = 0;
  for (let j = 0; j < p; j++) uVu += u[j] * Vu[j];
  const gchi = sumG2 > 0 ? (dTot * uVu) / sumG2 : NaN;
  return {
    transform: "km",
    rows,
    global: { name: "GLOBAL", chi2: gchi, df: p, p: Number.isFinite(gchi) ? chiSquareP(gchi, p) : NaN },
  };
}

// ---------------------------------------------------------------------------
// Breslow baseline at the covariate means; adjusted curves
// ---------------------------------------------------------------------------

function breslowBaseline(P: Prepared, gamma: Float64Array): { time: number; cumHazard: number }[] {
  const { p, Z, E, groups, n } = P;
  const eta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += Z[i * p + j] * gamma[j];
    eta[i] = s;
  }
  // Backwards: increment at each event time = d / Σ_R exp(η) (computed with offset m).
  const incs: { time: number; inc: number }[] = [];
  let S0 = 0;
  let m = -Infinity;
  for (let gi = 0; gi < groups.length; gi++) {
    const [a, b] = groups[gi];
    let gmax = -Infinity;
    for (let i = a; i < b; i++) if (eta[i] > gmax) gmax = eta[i];
    if (gmax > m) {
      if (Number.isFinite(m)) S0 *= Math.exp(m - gmax);
      m = gmax;
    }
    let d = 0;
    for (let i = a; i < b; i++) {
      S0 += Math.exp(eta[i] - m);
      if (E[i]) d++;
    }
    if (d) incs.push({ time: P.groupTime[gi], inc: (d / S0) * Math.exp(-m) });
  }
  incs.reverse();
  let H = 0;
  return incs.map((x) => {
    H += x.inc;
    return { time: x.time, cumHazard: H };
  });
}

function linearPredictorAtMeans(fit: CoxFit, x: number[]): number {
  if (x.length !== fit.coefficients.length) throw new Error(`Expected ${fit.coefficients.length} covariate values, got ${x.length}.`);
  let s = 0;
  for (let j = 0; j < x.length; j++) s += (x[j] - fit.means[j]) * fit.coefficients[j].beta;
  return s;
}

/** S(t | x) from the Breslow baseline: exp(−H₀(t)·exp((x − x̄)′β)). `x` in original units, covariate order. */
export function coxSurvivalAt(fit: CoxFit, x: number[], t: number): number {
  const r = Math.exp(linearPredictorAtMeans(fit, x));
  let H = 0;
  for (const b of fit.baseline) {
    if (b.time > t) break;
    H = b.cumHazard;
  }
  return Math.exp(-H * r);
}

/** The adjusted survival step curve for covariate vector x: (0, 1) then one point per event time. */
export function coxAdjustedSurvival(fit: CoxFit, x: number[]): { time: number; survival: number }[] {
  const r = Math.exp(linearPredictorAtMeans(fit, x));
  const pts = [{ time: 0, survival: 1 }];
  for (const b of fit.baseline) pts.push({ time: b.time, survival: Math.exp(-b.cumHazard * r) });
  return pts;
}

export const COX_MAX_CURVES = 6;

/**
 * Which adjusted curves to draw (§B1, §E9), at most 6 (the cap is SAID in
 * `legendNote` and `truncated`):
 *  - the FIRST CATEGORICAL covariate in column order — a declared factor, or any
 *    column with exactly two distinct values (a 0/1 indicator is categorical) —
 *    gets one curve per level (reference / lower value included);
 *  - if there is no categorical covariate, the first covariate gets curves at its
 *    mean − 1 SD, mean, mean + 1 SD.
 * Everything else is held at its mean (continuous), its reference level (factor),
 * or its LOWER value (two-valued column) — never the mean of a 0/1 column, which
 * is a patient who does not exist. `legendNote` names every held value.
 */
export function coxCurveProfiles(fit: CoxFit): {
  profiles: { label: string; x: number[] }[];
  legendNote: string;
  truncated: boolean;
} {
  const p = fit.coefficients.length;
  const factorOf = new Map<string, CoxFactor>();
  for (const f of fit.factors) for (const c of f.columns) factorOf.set(c, f);
  const isTwo = (j: number) => !factorOf.has(fit.names[j]) && !!fit.coefficients[j].twoValues;
  const base = fit.coefficients.map((c, j) => (factorOf.has(c.name) ? 0 : isTwo(j) ? c.twoValues![0] : c.mean));

  // Which covariate defines the curves.
  let fIdx = -1;
  for (let j = 0; j < p; j++) if (factorOf.has(fit.names[j]) || isTwo(j)) { fIdx = j; break; }
  const f0 = fIdx >= 0 ? factorOf.get(fit.names[fIdx]) : undefined;
  const lead = fIdx >= 0 ? fIdx : 0;
  const skip = new Set<string>(f0 ? f0.columns : [fit.names[lead]]);

  const held: string[] = [];
  for (let j = 0; j < p; j++) {
    const nm = fit.names[j];
    if (skip.has(nm)) continue;
    const f = factorOf.get(nm);
    if (f) {
      if (!held.includes(`${f.name} = ${f.reference}`)) held.push(`${f.name} = ${f.reference}`);
    } else if (isTwo(j)) held.push(`${nm} = ${num(base[j], 6)}`);
    else held.push(`${nm} = ${num(fit.coefficients[j].mean, 4)} (mean)`);
  }
  const profiles: { label: string; x: number[] }[] = [];
  if (f0) {
    profiles.push({ label: `${f0.name} ${f0.reference}`, x: base.slice() });
    f0.levels.forEach((lvl, idx) => {
      const x = base.slice();
      const col = fit.names.indexOf(f0.columns[idx]);
      if (col >= 0) x[col] = 1;
      profiles.push({ label: `${f0.name} ${lvl}`, x });
    });
  } else if (fIdx >= 0) {
    for (const v of fit.coefficients[fIdx].twoValues!) {
      const x = base.slice();
      x[fIdx] = v;
      profiles.push({ label: `${fit.names[fIdx]} = ${num(v, 6)}`, x });
    }
  } else {
    const c = fit.coefficients[0];
    for (const k of [-1, 0, 1]) {
      const x = base.slice();
      x[0] = c.mean + k * c.sd;
      profiles.push({ label: `${fit.names[0]} = ${num(x[0], 4)}${k === 0 ? " (mean)" : k < 0 ? " (mean − 1 SD)" : " (mean + 1 SD)"}`, x });
    }
  }
  const truncated = profiles.length > COX_MAX_CURVES;
  const notes: string[] = [];
  if (held.length) notes.push(`Other covariates held at ${held.join(", ")}.`);
  if (truncated) notes.push(`Showing ${COX_MAX_CURVES} of ${profiles.length} levels of ${f0 ? f0.name : fit.names[lead]} (at most ${COX_MAX_CURVES} curves).`);
  notes.push("Breslow baseline.");
  return { profiles: profiles.slice(0, COX_MAX_CURVES), legendNote: notes.join(" "), truncated };
}

// ---------------------------------------------------------------------------
// Forest-plot data (the integrator draws it on a LOG axis)
// ---------------------------------------------------------------------------

export interface CoxForestRow {
  label: string;
  hr: number;
  lo: number;
  hi: number;
  p: number;
}

/** One row per coefficient: label, HR and its 95% Wald CI, p. Factor indicators are labelled "Stage II vs I". */
export function coxForestData(fit: CoxFit): CoxForestRow[] {
  return fit.coefficients.map((c) => ({ label: coefLabel(fit, c.name), hr: c.hr, lo: c.ciLow, hi: c.ciHigh, p: c.p }));
}

function coefLabel(fit: CoxFit, name: string): string {
  for (const f of fit.factors) {
    const idx = f.columns.indexOf(name);
    if (idx >= 0) return `${f.name} ${f.levels[idx]} vs ${f.reference}`;
  }
  return name;
}

// ---------------------------------------------------------------------------
// Report text (display contract: β, χ², "to" inside CIs, typographic minus)
// ---------------------------------------------------------------------------

export function coxReportLines(fit: CoxFit): string[] {
  const out: string[] = [];
  const tiesName = fit.ties === "efron" ? "Efron" : "Breslow";
  out.push(
    `Cox regression (${tiesName} ties): n = ${fit.n}, ${fit.events} events, ${fit.parameters} parameter${fit.parameters === 1 ? "" : "s"} (${num(fit.eventsPerParameter, 3)} events per parameter)`,
  );
  for (const c of fit.coefficients) {
    out.push(
      `${coefLabel(fit, c.name)}: β = ${num(c.beta, 5)} (SE ${num(c.se, 4)}), HR = ${num(c.hr, 4)} (95% CI ${num(c.ciLow, 4)} to ${num(c.ciHigh, 4)}), z = ${num(c.z, 3)}, ${formatCoxP(c.p)}`,
    );
  }
  for (const c of fit.coefficients) {
    const label = coefLabel(fit, c.name);
    const isInd = label !== c.name;
    const dir = c.hr >= 1 ? "HR > 1" : "HR < 1";
    out.push(
      isInd
        ? `${dir}: ${label} multiplies the hazard by ${num(c.hr, 4)}`
        : `${dir}: a one-unit increase in ${c.name} multiplies the hazard by ${num(c.hr, 4)}`,
    );
  }
  const t = (lab: string, x: CoxTest) => `${lab}: χ²(${x.df}) = ${num(x.statistic, 4)}, ${formatCoxP(x.p)}`;
  out.push(t("Likelihood-ratio test", fit.likelihoodRatio));
  out.push(t("Wald test", fit.wald));
  out.push(t("Score (log-rank) test", fit.score));
  out.push(`Concordance (Harrell's C) = ${num(fit.concordance.c, 4)}`);
  out.push("Proportional-hazards check (scaled Schoenfeld residuals, Kaplan–Meier time transform):");
  for (const r of fit.phTest.rows) {
    out.push(
      `${coefLabel(fit, r.name)}: χ²(1) = ${num(r.chi2, 4)}, ${formatCoxP(r.p)}${r.p < 0.05 ? ` — the effect of ${coefLabel(fit, r.name)} changes over time; its single HR is an average` : ""}`,
    );
  }
  const gl = fit.phTest.global;
  out.push(`GLOBAL: χ²(${gl.df}) = ${num(gl.chi2, 4)}, ${formatCoxP(gl.p)}`);
  out.push(fit.convergence);
  return out;
}

// ---------------------------------------------------------------------------
// Dummy coding helper for the table feed (optional; pure)
// ---------------------------------------------------------------------------

export const COX_MAX_LEVELS = 10;

/**
 * Dummy-code a text column k−1. Reference = alphabetical first (as R, the default)
 * or first in order of appearance. Blank cells are refused BY ROW (no silent
 * complete-case drop); more than 10 levels is refused as an id, not a covariate.
 */
export function coxDummyCode(
  name: string,
  values: string[],
  reference: "alphabetical" | "first" = "alphabetical",
): { ok: true; covariates: CoxCovariate[]; factor: CoxFactor; note: string } | { ok: false; reason: string } {
  const clean = values.map((v) => (v == null ? "" : String(v).trim()));
  const blank = clean.findIndex((v) => v === "");
  if (blank >= 0) return { ok: false, reason: `${name} is blank in row ${blank + 1}. Fill it in or remove the row — the calculator does not drop rows silently.` };
  const appearance: string[] = [];
  for (const v of clean) if (!appearance.includes(v)) appearance.push(v);
  if (appearance.length > COX_MAX_LEVELS)
    return { ok: false, reason: `${name} has ${appearance.length} levels — an id, not a covariate (at most ${COX_MAX_LEVELS} levels).` };
  if (appearance.length < 2) return { ok: false, reason: `${name} has a single level (${appearance[0] ?? ""}), so its effect cannot be estimated — remove the column.` };
  const levels =
    reference === "alphabetical"
      ? appearance.slice().sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      : appearance.slice();
  const ref = levels[0];
  const rest = levels.slice(1);
  const safe = (s: string) => s.replace(/\s+/g, "_");
  const columns = rest.map((l) => `${safe(name)}_${safe(l)}`);
  const covariates = rest.map((l, k) => ({ name: columns[k], values: clean.map((v) => (v === l ? 1 : 0)) }));
  return {
    ok: true,
    covariates,
    factor: { name, reference: ref, levels: rest, columns },
    note: `${name}: reference ${ref}; ${listAnd(rest)} as indicators`,
  };
}
