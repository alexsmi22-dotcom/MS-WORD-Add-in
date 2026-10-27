/**
 * Loan amortization with extra payments (recurring and one-off), a balloon, and rate changes (release F1, gap item
 * #9). Pure: no Office.js, no DOM.
 *
 * Conventions (printed by the calculator):
 *   - periodic rate i = annual nominal rate / payments per year; interest each period = balance × i; nothing is rounded
 *     to cents (the schedule is exact; a lender's cent-rounded schedule can differ by cents);
 *   - level payment P·i/(1 − (1 + i)^−n), or with a balloon B due with the last payment (P − B(1 + i)^−n)·i/(1 − (1 + i)^−n)
 *     (numpy-financial pmt with fv = −B); "amortize over" a longer term computes the payment on that term and makes
 *     the balance at the loan term the balloon;
 *   - extra payments go to principal on top of the scheduled payment, which stays level, so the loan pays off sooner
 *     (an extra payment larger than the balance is cut to the balance);
 *   - at a rate change the payment is re-amortized: the balance then outstanding over the scheduled payments left, to
 *     the same balloon (never more than the balance), as an adjustable-rate loan recasts. Extra payments made before a
 *     rate change therefore lower the new payment rather than shorten the term from that point.
 */
import { MAX_AMORT_PERIODS } from "./finance";

export interface LoanInput {
  principal: number;
  /** Annual nominal rate as a fraction (0.05). */
  annualRate: number;
  /** Payments in the loan term (to the balloon). */
  n: number;
  /** Payments per year. */
  m: number;
  /** Payments the level payment is computed over (≥ n); n when absent. */
  amortN?: number;
  /** Balloon due with payment n (with amortN absent). */
  balloon?: number;
  /** Recurring extra principal each payment from payment `extraFrom` on. */
  extra?: number;
  extraFrom?: number;
  /** One-off extra payments: payment number → amount (summed when a number repeats). */
  lumps?: Map<number, number>;
  /** New annual rate (fraction) from payment k on. */
  rateChanges?: { k: number; rate: number }[];
}

export interface LoanRow {
  k: number;
  /** Annual rate in force (fraction). */
  rate: number;
  /** Scheduled payment actually paid (interest + scheduled principal; the last payment includes the balloon). */
  payment: number;
  extra: number;
  interest: number;
  /** All principal repaid this period (scheduled + extra). */
  principal: number;
  balance: number;
}

export interface LoanResult {
  rows: LoanRow[];
  /** The level payment at the start. */
  payment0: number;
  /** Each recast: payment number, new rate, new payment. */
  recasts: { k: number; rate: number; payment: number }[];
  totalInterest: number;
  totalPaid: number;
  totalExtra: number;
  /** The payment that clears the loan (n unless extra payments ended it sooner). */
  payoffK: number;
  /** The amount above the level payment paid with the last payment (the balloon), 0 when none. */
  balloonPaid: number;
}

/** numpy-financial pmt(i, n, −pv, fv) as a positive payment: pays pv down to `fv` over n periods. */
export function levelPayment(pv: number, i: number, n: number, fv = 0): number {
  if (n <= 0) return NaN;
  if (i === 0) return (pv - fv) / n;
  const v = Math.pow(1 + i, -n);
  return ((pv - fv * v) * i) / (1 - v);
}

export function loanSchedule(inp: LoanInput): LoanResult | { error: string } {
  const { principal: P, m, n } = inp;
  if (!Number.isInteger(n) || n < 1) return { error: "The loan term must be at least one payment." };
  if (n > MAX_AMORT_PERIODS) return { error: `The loan has ${n.toLocaleString("en-US")} payments; at most ${MAX_AMORT_PERIODS.toLocaleString("en-US")} are scheduled.` };
  const amortN = inp.amortN ?? n;
  if (!Number.isInteger(amortN) || amortN < n || amortN > MAX_AMORT_PERIODS) return { error: "The amortization term must be whole payments, no shorter than the loan term." };
  const changes = [...(inp.rateChanges ?? [])].sort((a, b) => a.k - b.k);
  const changeAt = new Map<number, number>();
  for (const c of changes) changeAt.set(c.k, c.rate);
  let annual = inp.annualRate;
  let i = annual / m;
  const balloonTarget = inp.balloon ?? 0;
  // payment over the amortization term; with a balloon, to that balloon over the loan term
  let pmt = amortN > n ? levelPayment(P, i, amortN) : levelPayment(P, i, n, balloonTarget);
  if (!Number.isFinite(pmt)) return { error: "The payment is not computable for these inputs." };
  const payment0 = pmt;
  const recasts: LoanResult["recasts"] = [];
  const rows: LoanRow[] = [];
  let bal = P;
  let totalInterest = 0;
  let totalPaid = 0;
  let totalExtra = 0;
  let balloonPaid = 0;
  const tiny = 1e-9 * Math.max(1, P);
  for (let k = 1; k <= n && bal > tiny; k++) {
    if (changeAt.has(k) && k > 1) {
      annual = changeAt.get(k)!;
      i = annual / m;
      const left = n - k + 1;
      if (amortN > n) pmt = levelPayment(bal, i, amortN - k + 1);
      else pmt = levelPayment(bal, i, left, Math.min(balloonTarget, bal));
      recasts.push({ k, rate: annual, payment: pmt });
    }
    const interest = bal * i;
    let sched = pmt - interest;
    let pay = pmt;
    let extra = 0;
    if (k === n || sched >= bal) {
      // the last payment (or a scheduled payment that more than clears the balance) pays off everything
      if (k === n && bal - sched > tiny) balloonPaid = bal - sched;
      sched = bal;
      pay = bal + interest;
    } else {
      extra = (inp.extra && k >= (inp.extraFrom ?? 1) ? inp.extra : 0) + (inp.lumps?.get(k) ?? 0);
      if (extra > bal - sched) extra = bal - sched;
    }
    const principal = sched + extra;
    bal -= principal;
    if (Math.abs(bal) <= tiny) bal = 0;
    totalInterest += interest;
    totalPaid += pay + extra;
    totalExtra += extra;
    rows.push({ k, rate: annual, payment: pay, extra, interest, principal, balance: bal });
  }
  return { rows, payment0, recasts, totalInterest, totalPaid, totalExtra, payoffK: rows.length, balloonPaid };
}
