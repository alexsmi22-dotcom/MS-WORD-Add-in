/**
 * Lost earnings, forensic grade (Release F2, gap item #8): the LPE method (each period's lost earning capacity ×
 * P(alive) × P(participating) × P(employed)) or a worklife-expectancy horizon from the user's own worklife table,
 * with taxes, fringe benefits, personal consumption, household services, a residual earning capacity offset, a past
 * vs future split at the trial date with prejudgment interest on past losses (damagesInterest.ts's engine), and
 * discounting of future losses (growth + discount, or a net discount rate). US dollars, like the other damages tools.
 *
 * Every rate, probability, worklife figure and the tax rate is the user's input; nothing is bundled as law or as a
 * worklife statistic. The life table is the bundled CDC 2024 table or the user's own (lifeTable.ts).
 *
 * CONVENTIONS (printed in every result; mirrored by scripts/forensic-oracle.py):
 *  - Time t is in years since the date of injury, t = days ÷ 365.25; age = age at injury + t.
 *  - Loss year k covers [k − 1, k); the year holding the trial date is split there into a past part and a future part.
 *    Rows run until the earnings end (LPE: the end age entered; WLE: the worklife expectancy after the injury) or the
 *    household services end, whichever is later.
 *  - Earning capacity lost in loss year k = (pre-injury earnings − residual earning capacity) × (1 + g)^(k − 1) × the
 *    share of the year covered. Net: × (1 − tax rate + fringe rate) × (1 − personal consumption): the tax applies to
 *    earnings, fringe benefits are added untaxed, consumption is taken from both.
 *  - LPE: the net loss × P(alive) × P(participating) × P(employed), the probabilities at the age at the middle of the
 *    covered part of the row; participation and employment are the user's per-age rows (the row with the largest
 *    from-age at or below the age). The residual capacity is offset before the probabilities, so it carries the same
 *    weights. WLE: earnings run for the worklife expectancy entered and no probabilities are applied to them.
 *  - P(alive): living plaintiff: past periods 1; future periods l(age)/l(age at trial). Wrongful death: every period
 *    l(age)/l(age at injury). lx linear between whole ages (UDD).
 *  - Household services = hours a week × 52 × value an hour × (1 + services growth)^(k − 1) × share of the year ×
 *    P(alive); no participation or employment weights.
 *  - Net discount rate mode: past periods grow at g; future periods stay at the level of the loss year that holds the
 *    trial date and are discounted at the net discount rate. Growth + discount mode: every period grows; future
 *    periods are discounted at the discount rate.
 *  - Future discounting from the trial date, over the time to the row's middle (mid-year) or end (end of year).
 *  - Prejudgment interest: each past row accrues from its middle day (injury day + round(middle × 365.25)) up to, not
 *    including, the trial date, at the user's rate, simple or compounded annually, actual/365 (damagesInterest.ts).
 *  - Each row's amounts are rounded to the cent; totals are sums of the rounded rows.
 */
import { MAX_AMOUNT, moneyCents, prejudgmentInterest, toCents, type RateRow, type Tranche } from "./damagesInterest";
import { usd } from "./damagesUsd";
import { finFixed, finPlotSvg } from "./financeFigures";
import { lAt, endAge, type LifeTable } from "./lifeTable";

export const DAYS_PER_YEAR = 365.25;
/** Longest span of rows, in years. */
export const LPE_MAX_YEARS = 100;

export interface PeRow {
  fromAge: number;
  /** Participation, decimal. */
  part: number;
  /** Employment, decimal. */
  emp: number;
}

export interface LpeInput {
  dob: number;
  injury: number;
  trial: number;
  table: LifeTable;
  base: number;
  residual: number;
  /** Decimal growth of earnings. */
  growth: number;
  method: "lpe" | "wle";
  /** LPE: the age at which earnings would have stopped. */
  workEndAge: number;
  /** WLE: worklife expectancy in years from the injury (the user's table). */
  wle: number;
  pe: PeRow[];
  fringe: number;
  tax: number;
  consumption: number;
  hhHours: number;
  hhValue: number;
  hhGrowth: number;
  hhEndAge: number;
  survivalFrom: "trial" | "injury";
  discountMode: "growth" | "ndr";
  discount: number;
  ndr: number;
  midYear: boolean;
  pjiRate: number;
  pjiMethod: "simple" | "annual";
}

export interface LpeRow {
  k: number;
  past: boolean;
  /** Start and end, years since injury. */
  a: number;
  b: number;
  /** Age at the middle of the row. */
  ageMid: number;
  /**
   * The age the probabilities were read at: the middle of the part of the row with earnings (fix-fin R2 MINOR: a
   * partial final row printed 66.72, the row's middle, while P(alive) and P(part.) were read at 66.61).
   */
  ageEarn: number;
  capacityCents: number;
  pAliveEarn: number;
  /** Share of the row with earnings (0 after the earnings end). */
  earnLen: number;
  /** P(participating) × P(employed); 1 under WLE. */
  pPe: number;
  earnCents: number;
  hhCents: number;
  totalCents: number;
  /** Past rows. */
  interestCents: number;
  accrualDay: number;
  /** Future rows. */
  df: number;
  valueCents: number;
}

export interface LpeResult {
  rows: LpeRow[];
  ageInjury: number;
  ageTrial: number;
  tTrial: number;
  tEarn: number;
  tHh: number;
  pastCents: number;
  interestCents: number;
  futureCents: number;
  futurePvCents: number;
  totalCents: number;
}

type Refusal = { error: string };

const overlap = (a: number, b: number, lo: number, hi: number): number => Math.max(0, Math.min(b, hi) - Math.max(a, lo));

function peAt(pe: PeRow[], age: number): PeRow {
  let r = pe[0];
  for (const p of pe) if (p.fromAge <= age + 1e-9) r = p;
  return r;
}

/** The schedule, or a named refusal. Inputs are already range-checked by the reader (forensicCalcs' lpeCalc). */
export function lostEarningsLpe(o: LpeInput): LpeResult | Refusal {
  const ageInjury = (o.injury - o.dob) / DAYS_PER_YEAR;
  const tTrial = (o.trial - o.injury) / DAYS_PER_YEAR;
  const ageTrial = ageInjury + tTrial;
  if (!(lAt(o.table, ageInjury) > 0)) {
    return { error: `The life table (${o.table.label}) has no lives at the age at injury (${finFixed(ageInjury, 2)}); it covers ages ${o.table.startAge}–${endAge(o.table)}.` };
  }
  if (o.survivalFrom === "trial" && !(lAt(o.table, ageTrial) > 0)) {
    return { error: `The life table (${o.table.label}) has no lives at the age at trial (${finFixed(ageTrial, 2)}).` };
  }
  const tEarn = o.method === "lpe" ? o.workEndAge - ageInjury : o.wle;
  if (!(tEarn > 0)) return { error: `The earnings end age (${finFixed(o.workEndAge, 2)}) must be above the age at injury (${finFixed(ageInjury, 2)}).` };
  const tHh = o.hhHours > 0 && o.hhValue > 0 ? Math.max(0, o.hhEndAge - ageInjury) : 0;
  const tMax = Math.max(tEarn, tHh);
  if (tMax > LPE_MAX_YEARS) return { error: `More than ${LPE_MAX_YEARS} years after the injury is outside this calculator (the earnings or services end age is too far ahead).` };
  const basisAge = o.survivalFrom === "trial" ? ageTrial : ageInjury;
  const lBasis = lAt(o.table, basisAge);
  const pAlive = (age: number, past: boolean): number => (o.survivalFrom === "trial" && past ? 1 : lAt(o.table, age) / lBasis);
  const kTrial = Math.floor(tTrial) + 1;
  const hhAnnual = o.hhHours * 52 * o.hhValue;
  const capAnnual = o.base - o.residual;
  const netShare = (1 - o.tax + o.fringe) * (1 - o.consumption);
  const rows: LpeRow[] = [];
  const nYears = Math.ceil(tMax - 1e-9);
  const cap = MAX_AMOUNT * 100;
  for (let k = 1; k <= nYears; k++) {
    const y0 = k - 1;
    const y1 = Math.min(k, tMax);
    const parts: [number, number][] = tTrial > y0 && tTrial < y1 ? [[y0, tTrial], [tTrial, y1]] : [[y0, y1]];
    for (const [a, b] of parts) {
      if (!(b - a > 1e-12)) continue;
      const past = b <= tTrial + 1e-12;
      const gExp = o.discountMode === "ndr" && !past ? kTrial - 1 : k - 1;
      const eLen = overlap(a, b, 0, tEarn);
      const hLen = overlap(a, b, 0, tHh);
      const eAge = ageInjury + a + eLen / 2;
      const hAge = ageInjury + a + hLen / 2;
      const capacity = capAnnual * Math.pow(1 + o.growth, gExp) * eLen;
      const pa = eLen > 0 && o.method === "lpe" ? pAlive(eAge, past) : 1;
      const pr = peAt(o.pe, eAge);
      const pPe = o.method === "lpe" ? pr.part * pr.emp : 1;
      const earn = capacity * netShare * pa * pPe;
      const hh = hLen > 0 ? hhAnnual * Math.pow(1 + o.hhGrowth, gExp) * hLen * pAlive(hAge, past) : 0;
      const capacityCents = toCents(capacity);
      const earnCents = toCents(earn);
      const hhCents = toCents(hh);
      const totalCents = earnCents + hhCents;
      const mid = (a + b) / 2;
      const tau = (o.midYear ? mid : b) - tTrial;
      const rate = o.discountMode === "ndr" ? o.ndr : o.discount;
      const df = past ? 1 : Math.pow(1 + rate, -tau);
      const valueCents = past ? totalCents : toCents((totalCents / 100) * df);
      if (![capacityCents, earnCents, hhCents, valueCents, df].every(Number.isFinite) || Math.max(Math.abs(capacityCents), Math.abs(totalCents), Math.abs(valueCents)) > cap) {
        return { error: `Loss year ${k}: an amount is above ${usd("1,000,000,000,000.00")}, outside this calculator; lower the earnings, the growth rate or the horizon.` };
      }
      rows.push({
        k,
        past,
        a,
        b,
        ageMid: ageInjury + mid,
        ageEarn: eLen > 0 ? eAge : ageInjury + mid,
        capacityCents,
        pAliveEarn: pa,
        earnLen: eLen,
        pPe,
        earnCents,
        hhCents,
        totalCents,
        interestCents: 0,
        accrualDay: past ? o.injury + Math.round(mid * DAYS_PER_YEAR) : 0,
        df,
        valueCents,
      });
    }
  }
  // Prejudgment interest on the past rows (the damages engine: exact cents, anniversaries of each row's accrual day).
  const pastRows = rows.filter((r) => r.past);
  let interestCents = 0;
  if (pastRows.length && o.pjiRate > 0) {
    const tranches: Tranche[] = pastRows.map((r, i) => ({ row: i + 1, label: `loss year ${r.k}`, amount: r.totalCents / 100, accrual: Math.min(r.accrualDay, o.trial) }));
    const units = Math.round(o.pjiRate * 1e6);
    const rates: RateRow[] = [{ row: 1, from: o.injury, to: Infinity, rate: units / 1e6, units, closed: false }];
    const pj = prejudgmentInterest({ tranches, rates, end: o.trial, method: o.pjiMethod, dayCount: "act365" });
    if ("error" in pj) return pj;
    pj.rows.forEach((pr, i) => {
      pastRows[i].interestCents = pr.interestCents;
      interestCents += pr.interestCents;
    });
  }
  let pastCents = 0;
  let futureCents = 0;
  let futurePvCents = 0;
  for (const r of rows) {
    if (r.past) pastCents += r.totalCents;
    else {
      futureCents += r.totalCents;
      futurePvCents += r.valueCents;
    }
  }
  const totalCents = pastCents + interestCents + futurePvCents;
  if (Math.max(Math.abs(pastCents), Math.abs(futureCents), Math.abs(totalCents)) > cap) {
    return { error: `A total is above ${usd("1,000,000,000,000.00")}, outside this calculator.` };
  }
  return { rows, ageInjury, ageTrial, tTrial, tEarn, tHh, pastCents, interestCents, futureCents, futurePvCents, totalCents };
}

/** Whole cents as US dollars. */
export const money = (cents: number): string => usd(moneyCents(cents));

/** A row's label: the loss-year number, and for the year split at the trial date which side of it. */
export function rowLabel(r: LpeRow, splitYear: boolean): string {
  if (!splitYear) return String(r.k);
  return r.past ? `${r.k}, to trial` : `${r.k}, from trial`;
}

/** The figure: expected loss per period and its value at the trial date, by age. */
export function lpeFigure(res: LpeResult): string | undefined {
  if (res.rows.length < 2) return undefined;
  return finPlotSvg(
    [
      { points: res.rows.map((r) => ({ x: r.ageMid, y: r.totalCents / 100 })), type: "line", color: "#b45309", label: "expected loss" },
      { points: res.rows.map((r) => ({ x: r.ageMid, y: (r.valueCents + r.interestCents) / 100 })), type: "line", color: "#2563eb", label: "value at trial date" },
    ],
    { width: 380, height: 250, title: "Losses by age", xlabel: "age", ylabel: "amount ($)", yGrouping: "comma" },
  );
}
