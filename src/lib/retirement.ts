/**
 * Retirement arithmetic (Release F2, gap item #17): an accumulation-and-drawdown schedule with inflation and the real
 * return, and a safe-withdrawal Monte Carlo (probability of ruin by year, optionally weighted by a life table).
 * Currency-neutral like the rest of Finance: bare grouped amounts.
 *
 * CONVENTIONS (printed in every result; mirrored by scripts/forensic-oracle.py):
 *  Schedule
 *  - One row per year of age from the current age to the plan-to age. Contributions (before the retirement age) and
 *    withdrawals (from it) are made at the START of each year, in today's money indexed by inflation: year t's flow
 *    = amount × (1 + π)^(t − 1). The balance after the flow earns the nominal return r for the year.
 *  - A withdrawal larger than the balance takes what is there and the balance is 0 from then on (depleted).
 *  - Today's money = nominal ÷ (1 + π)^t at the end of year t. Real return = (1 + r)/(1 + π) − 1 (Fisher, exact).
 *  - Sustainable withdrawal: the level real withdrawal that exactly uses the balance at retirement over the years to
 *    the plan-to age at the real return (annuity-due).
 *  Monte Carlo
 *  - Real terms: the withdrawal is the same in today's money every year (it rises with inflation in nominal money).
 *  - Each year's real return R is lognormal with the entered mean and standard deviation of R:
 *    s² = ln(1 + σ²/(1 + μ)²), m = ln(1 + μ) − s²/2, 1 + R = exp(m + s z).
 *  - z by Box–Muller from two uniforms, z = √(−2 ln u₁) cos(2π u₂); u = (r + 0.5)/2³² from successive PCG32 outputs
 *    (prng.ts, stream 54) seeded by the Seed field. Draw order: year by year, and within a year path by path; every
 *    path draws every year (a ruined path's draws are discarded).
 *  - Year t: the withdrawal is taken at the start of the year; a balance below the withdrawal is ruin in year t.
 *    Otherwise balance ← (balance − withdrawal) × (1 + R).
 *  - P(ruin while alive) = Σ_t P(ruin in year t) × P(alive at the start of year t) (ruin and death independent).
 *  - Percentiles by linear interpolation between order statistics (Hyndman–Fan type 7); ruined paths count as 0.
 */
import { Pcg32, PCG_STREAM } from "./prng";

export interface ScheduleInput {
  age: number;
  retireAge: number;
  endAge: number;
  balance: number;
  contribution: number;
  withdrawal: number;
  /** Decimal nominal return. */
  ret: number;
  /** Decimal inflation. */
  infl: number;
}

export interface ScheduleRow {
  age: number;
  start: number;
  /** + contribution, − withdrawal actually taken. */
  flow: number;
  growth: number;
  end: number;
  real: number;
  depleted: boolean;
}

export interface ScheduleResult {
  rows: ScheduleRow[];
  realReturn: number;
  /** Balance at the start of the retirement year, before its withdrawal (nominal and today's money). */
  atRetire: number;
  atRetireReal: number;
  /** First age whose withdrawal could not be paid in full, or null. */
  runsOutAge: number | null;
  sustainable: number | null;
}

export function retirementSchedule(o: ScheduleInput): ScheduleResult {
  const rows: ScheduleRow[] = [];
  let bal = o.balance;
  let runsOutAge: number | null = null;
  let atRetire = o.retireAge <= o.age ? o.balance : NaN;
  let atRetireReal = atRetire;
  const n = o.endAge - o.age;
  for (let t = 1; t <= n; t++) {
    const age = o.age + t - 1;
    const idx = Math.pow(1 + o.infl, t - 1);
    const start = bal;
    if (age === o.retireAge) {
      atRetire = start;
      atRetireReal = start / idx;
    }
    let flow: number;
    let depleted = false;
    if (age < o.retireAge) flow = o.contribution * idx;
    else {
      const want = o.withdrawal * idx;
      if (want > start + 1e-9 * Math.max(1, want)) {
        flow = -start;
        depleted = true;
        if (runsOutAge === null) runsOutAge = age;
      } else flow = -want;
    }
    const after = Math.max(0, start + flow);
    const growth = after * o.ret;
    bal = after + growth;
    rows.push({ age, start, flow, growth, end: bal, real: bal / Math.pow(1 + o.infl, t), depleted });
  }
  if (!Number.isFinite(atRetire)) {
    // Retirement at the plan-to age: the balance it reaches.
    atRetire = bal;
    atRetireReal = bal / Math.pow(1 + o.infl, n);
  }
  const realReturn = (1 + o.ret) / (1 + o.infl) - 1;
  const m = o.endAge - Math.max(o.retireAge, o.age);
  let sustainable: number | null = null;
  if (m > 0 && Number.isFinite(atRetireReal)) {
    const v = 1 / (1 + realReturn);
    const ad = Math.abs(realReturn) < 1e-12 ? m : (1 - Math.pow(v, m)) / (1 - v);
    sustainable = atRetireReal / ad;
  }
  return { rows, realReturn, atRetire, atRetireReal, runsOutAge, sustainable };
}

export interface SwrInput {
  balance: number;
  withdrawal: number;
  years: number;
  /** Decimal mean and SD of the real return. */
  mean: number;
  sd: number;
  paths: number;
  seed: number;
  /** P(alive at the start of year t), t = 1 … years (index t − 1), or null. */
  alive: number[] | null;
}

export interface SwrResult {
  /** Cumulative share of paths ruined by the end of year t (index t − 1). */
  ruinBy: number[];
  /** Balance percentiles (10, 50, 90) at the end of each year. */
  p10: number[];
  p50: number[];
  p90: number[];
  ruinWhileAlive: number | null;
  m: number;
  s: number;
}

const M_LOG = Math.log;
const M_SQRT = Math.sqrt;
const M_COS = Math.cos;
const M_EXP = Math.exp;
const TWO32 = 4294967296;
const TWO_PI = 2 * Math.PI;

/**
 * Moves the k-th smallest of w[l..r] to w[k] (Hoare partition, median-of-three pivot), leaving w[l..k−1] ≤ w[k] ≤
 * w[k+1..r]. In place; O(r − l) expected.
 */
function selectInPlace(w: Float64Array, l: number, r: number, k: number): void {
  let guard = 0;
  const cap = 4 * (r - l + 1) + 64;
  while (r > l) {
    if (++guard > cap) throw new Error("selectInPlace did not converge");
    const m = (l + r) >>> 1;
    const x = w[l];
    const y = w[m];
    const z = w[r];
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
    let i = l;
    let j = r;
    while (i <= j) {
      while (w[i] < pivot) i++;
      while (w[j] > pivot) j--;
      if (i <= j) {
        const t = w[i];
        w[i] = w[j];
        w[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) r = j;
    else if (k >= i) l = i;
    else return;
  }
}

const BUCKETS = 4096;

/** Scratch arrays for percentiles109050, allocated once per simulation. */
export interface QuantileScratch {
  work: Float64Array;
  bucket: Uint16Array;
  counts: Int32Array;
  offset: Int32Array;
  fill: Int32Array;
}

export function quantileScratch(n: number): QuantileScratch {
  return { work: new Float64Array(n), bucket: new Uint16Array(n), counts: new Int32Array(BUCKETS), offset: new Int32Array(BUCKETS), fill: new Int32Array(BUCKETS) };
}

/**
 * Type-7 10th, 50th and 90th percentiles of a: the same numbers as quantilesOf(a, [0.1, 0.5, 0.9]) (an order statistic
 * is an exact element of a, whatever the algorithm finds it), in about three cheap passes instead of a quickselect per
 * order statistic. The values are counted into 4,096 equal-width buckets between the minimum and the maximum; each
 * wanted order statistic k (and k + 1, for the interpolation) falls in a known bucket at a known rank; only those
 * buckets' elements are gathered and selected among.
 */
export function percentiles109050(a: Float64Array, sc: QuantileScratch): [number, number, number] {
  const n = a.length;
  const last = n - 1;
  const ps = [0.1, 0.5, 0.9];
  const kLo = ps.map((p) => Math.floor(last * p));
  let lo = a[0];
  let hi = a[0];
  for (let j = 1; j < n; j++) {
    const v = a[j];
    if (v < lo) lo = v;
    else if (v > hi) hi = v;
  }
  if (!(hi > lo)) return [lo, lo, lo];
  const { work, bucket, counts, offset, fill } = sc;
  counts.fill(0);
  const scale = BUCKETS / (hi - lo);
  const top = BUCKETS - 1;
  for (let j = 0; j < n; j++) {
    let b = ((a[j] - lo) * scale) | 0;
    if (b > top) b = top;
    bucket[j] = b;
    counts[b]++;
  }
  // The wanted ranks (k and k + 1 for each percentile), ascending and distinct; their buckets and ranks within them.
  const want = [...new Set(kLo.flatMap((k) => [k, Math.min(last, k + 1)]))].sort((x, y) => x - y);
  const wb: number[] = [];
  const wr: number[] = [];
  let cum = 0;
  let b = 0;
  for (const k of want) {
    while (cum + counts[b] <= k) cum += counts[b++];
    wb.push(b);
    wr.push(k - cum);
  }
  // Gather the needed buckets' elements into contiguous segments of work.
  offset.fill(-1);
  let off = 0;
  for (const bb of wb) {
    if (offset[bb] >= 0) continue;
    offset[bb] = off;
    fill[bb] = 0;
    off += counts[bb];
  }
  for (let j = 0; j < n; j++) {
    const o = offset[bucket[j]];
    if (o >= 0) work[o + fill[bucket[j]]++] = a[j];
  }
  // Select within each segment, ranks ascending (each later selection only looks right of the previous one).
  const val = new Map<number, number>();
  let prevB = -1;
  let from = 0;
  for (let i = 0; i < want.length; i++) {
    const bb = wb[i];
    const s = offset[bb];
    const e = s + counts[bb] - 1;
    if (bb !== prevB) from = s;
    selectInPlace(work, from, e, s + wr[i]);
    val.set(want[i], work[s + wr[i]]);
    from = s + wr[i] + 1;
    prevB = bb;
  }
  return ps.map((p, i) => {
    const h = last * p;
    const k = kLo[i];
    const a0 = val.get(k)!;
    const a1 = val.get(Math.min(last, k + 1))!;
    return a0 + (h - k) * (a1 - a0);
  }) as [number, number, number];
}

export function swrMonteCarlo(o: SwrInput): SwrResult {
  const s2 = M_LOG(1 + (o.sd * o.sd) / ((1 + o.mean) * (1 + o.mean)));
  const s = M_SQRT(s2);
  const m = M_LOG(1 + o.mean) - s2 / 2;
  const rng = new Pcg32(o.seed, PCG_STREAM);
  const n = o.paths;
  const bal = new Float64Array(n).fill(o.balance);
  const ruined = new Uint8Array(n);
  const scratch = quantileScratch(n);
  let ruinedCount = 0;
  const ruinBy: number[] = [];
  const p10: number[] = [];
  const p50: number[] = [];
  const p90: number[] = [];
  let whileAlive = 0;
  const w = o.withdrawal;
  for (let t = 0; t < o.years; t++) {
    let newly = 0;
    for (let j = 0; j < n; j++) {
      const u1 = (rng.nextU32() + 0.5) / TWO32;
      const u2 = (rng.nextU32() + 0.5) / TWO32;
      if (ruined[j]) continue;
      const b = bal[j];
      if (b < w) {
        ruined[j] = 1;
        bal[j] = 0;
        newly++;
        continue;
      }
      const z = M_SQRT(-2 * M_LOG(u1)) * M_COS(TWO_PI * u2);
      bal[j] = (b - w) * M_EXP(m + s * z);
    }
    ruinedCount += newly;
    if (o.alive) whileAlive += (newly / n) * o.alive[t];
    ruinBy.push(ruinedCount / n);
    const q = percentiles109050(bal, scratch);
    p10.push(q[0]);
    p50.push(q[1]);
    p90.push(q[2]);
  }
  return { ruinBy, p10, p50, p90, ruinWhileAlive: o.alive ? whileAlive : null, m, s };
}
