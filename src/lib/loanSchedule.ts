/**
 * Loan amortization with extra payments (recurring and one-off), a balloon, and rate changes (release F1, gap item
 * #9). Pure: no Office.js, no DOM.
 *
 * Conventions (printed by the calculator): the LENDER CENT CONVENTION.
 *   - every amount is carried in whole cents (integers, never floats), so each row balances and every column sums
 *     exactly to its total;
 *   - periodic rate i = annual nominal rate / payments per year; each period's interest = balance × i rounded half up
 *     to the cent (computed exactly in integers: the annual rate is taken to 9 decimal places of a fraction);
 *   - level payment P·i/(1 − (1 + i)^−n), or with a balloon B due with the last payment (P − B(1 + i)^−n)·i/(1 − (1 + i)^−n)
 *     (numpy-financial pmt with fv = −B), computed EXACTLY as a rational number at the same 9-decimal rate the
 *     interest uses, rounded half up to the cent; "amortize over" a longer term computes the
 *     payment on that term and makes the balance at the loan term the balloon;
 *   - principal = payment + extra − interest; the last payment is the remaining balance plus its interest (it adjusts
 *     for the cents, and carries any balloon);
 *   - extra payments go to principal on top of the scheduled payment, which stays level, so the loan pays off sooner
 *     (an extra payment larger than the balance is cut to the balance); an extra payment listed for the payment that
 *     clears the loan is not applied (that payment pays the whole balance anyway) and is reported as such;
 *   - at a rate change the payment is re-amortized (rounded to the cent): the balance then outstanding over the
 *     scheduled payments left, to the same balloon (never more than the balance), as an adjustable-rate loan recasts.
 *     Extra payments made before a rate change therefore lower the new payment rather than shorten the term.
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

/** One row in whole cents (safe integers). */
export interface LoanRowCents {
  payment: number;
  extra: number;
  interest: number;
  principal: number;
  balance: number;
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
  /** The same amounts in whole cents. */
  c: LoanRowCents;
}

export interface LoanResult {
  rows: LoanRow[];
  /** The level payment at the start (rounded to the cent). */
  payment0: number;
  /** Each recast: payment number, new rate, new payment. */
  recasts: { k: number; rate: number; payment: number }[];
  totalInterest: number;
  totalPaid: number;
  totalExtra: number;
  /** Totals in whole cents. */
  totalsC: { interest: number; paid: number; extra: number; principal: number };
  /** The payment that clears the loan: n, unless extra payments or a payment rounded up to the cent ended it sooner. */
  payoffK: number;
  /** The amount above the level payment paid with the last payment (the balloon), 0 when none. */
  balloonPaid: number;
  /** One-off extra payments listed for the payment that cleared the loan, not applied (payment number → amount). */
  lumpsNotApplied: number[];
}

/** Dollars → whole cents, half up (amounts entered by the user have at most cents; float noise is absorbed). */
export function toCents(x: number): number {
  return Math.sign(x) * Math.floor(Math.abs(x) * 100 + 0.5 + 1e-9);
}

/** Whole cents as a grouped amount: 123456 → "1,234.56". */
function centsText(c: number): string {
  return (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** An annual rate (fraction) as a percentage, trailing zeros dropped: 0.06 → "6%". */
function pctText(r: number): string {
  return (r * 100).toLocaleString("en-US", { maximumFractionDigits: 4 }) + "%";
}

const RATE_SCALE = 1_000_000_000n;

/** Interest in cents on `balC` cents for one period at annual nano-rate R over m payments a year, half up, exact. */
function interestCents(balC: number, R: bigint, m: number): number {
  if (balC <= 0 || R === 0n) return 0;
  const D = BigInt(m) * RATE_SCALE;
  return Number((2n * BigInt(balC) * R + D) / (2n * D));
}

const bigGcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a;
};

/**
 * The level payment in cents, EXACT, rounded half up: (P·(1 + i)ⁿ − B)·i / ((1 + i)ⁿ − 1) with i = R/(m·10⁹), the same
 * nano-rate the interest uses, evaluated as one rational number in integers. (The float formula was a cent off exact
 * half-up in about 1 case in 400 at amounts above about 10¹⁰.) With i = r/d in lowest terms and a = d + r:
 * payment = (P·aⁿ − B·dⁿ)·r / (d·(aⁿ − dⁿ)).
 */
function paymentCents(pvC: number, R: bigint, m: number, nper: number, fvC: number): number {
  if (R === 0n) {
    const num = BigInt(pvC - fvC);
    const d = BigInt(nper);
    return Number((2n * num + d) / (2n * d));
  }
  const D = BigInt(m) * RATE_SCALE;
  const g = bigGcd(R, D);
  const r = R / g;
  const d = D / g;
  const N = BigInt(nper);
  const P = BigInt(pvC);
  const B = BigInt(fvC);
  // payment = r·(P·v − B)/(d·(v − 1)) with v = (1 + i)ⁿ, which falls as v grows (B ≤ P). The exact aⁿ runs to ~400,000
  // bits at 12,000 payments (~6 ms, too slow for 120 recasts), so v is first bracketed in 256-bit fixed point (floored
  // and ceiled at every step: a rigorous lower and upper bound); when both bounds give the same cent, that is the exact
  // half-up cent. Only when they straddle a half cent is the exact rational evaluated.
  const halfUp = (num: bigint, den: bigint): number => (num <= 0n ? 0 : Number((2n * num + den) / (2n * den)));
  const F = 256n;
  const one = 1n << F;
  const ceilShift = (x: bigint): bigint => (x + one - 1n) >> F;
  const q = (d + r) << F;
  let blo = q / d;
  let bhi = q % d === 0n ? blo : blo + 1n;
  let vlo = one;
  let vhi = one;
  for (let e = N; e > 0n; ) {
    if (e & 1n) {
      vlo = (vlo * blo) >> F;
      vhi = ceilShift(vhi * bhi);
    }
    e >>= 1n;
    if (e > 0n) {
      blo = (blo * blo) >> F;
      bhi = ceilShift(bhi * bhi);
    }
  }
  if (vlo > one) {
    const hi = halfUp(r * (P * vlo - B * one), d * (vlo - one));
    const lo = halfUp(r * (P * vhi - B * one), d * (vhi - one));
    if (hi === lo) return hi;
  }
  const an = (d + r) ** N;
  const dn = d ** N;
  return halfUp((P * an - B * dn) * r, d * (an - dn));
}

export function loanSchedule(inp: LoanInput): LoanResult | { error: string } {
  const { m, n } = inp;
  if (!Number.isInteger(n) || n < 1) return { error: "The loan term must be at least one payment." };
  if (n > MAX_AMORT_PERIODS) return { error: `The loan has ${n.toLocaleString("en-US")} payments; at most ${MAX_AMORT_PERIODS.toLocaleString("en-US")} are scheduled.` };
  const amortN = inp.amortN ?? n;
  if (!Number.isInteger(amortN) || amortN < n || amortN > MAX_AMORT_PERIODS) return { error: "The amortization term must be whole payments, no shorter than the loan term." };
  const Pc = toCents(inp.principal);
  if (!(Pc >= 100)) return { error: "The loan amount must be at least 1.00." };
  if (Pc > 1e15) return { error: "The loan amount must be at most 10,000,000,000,000." };
  const changes = [...(inp.rateChanges ?? [])].sort((a, b) => a.k - b.k);
  const changeAt = new Map<number, number>();
  for (const c of changes) changeAt.set(c.k, c.rate);
  let annual = inp.annualRate;
  // one rate for the payment and the interest: the annual rate to 9 decimal places of a fraction
  let R = BigInt(Math.round(annual * 1e9));
  const Bc = toCents(inp.balloon ?? 0);
  // payment over the amortization term; with a balloon, to that balloon over the loan term
  let pmtC = amortN > n ? paymentCents(Pc, R, m, amortN, 0) : paymentCents(Pc, R, m, n, Bc);
  if (!Number.isSafeInteger(pmtC)) return { error: "The payment is not computable for these inputs." };
  const firstInterest = interestCents(Pc, R, m);
  // rounded to the cent, a tiny loan's payment can equal (or fall below) its interest: it would never amortize
  // (an interest-only loan, balloon = principal, is the one case where payment = interest is intended)
  if (n > 1 && (pmtC <= 0 || pmtC < firstInterest || (pmtC === firstInterest && Bc < Pc)))
    return {
      error:
        `Over ${n.toLocaleString("en-US")} payments the payment rounds to ${centsText(pmtC)} a period, ` +
        `no more than the first period's interest (${centsText(firstInterest)}), so rounded to the cent the loan would not amortize. Use fewer payments or a larger amount.`,
    };
  const payment0 = pmtC / 100;
  const recasts: LoanResult["recasts"] = [];
  const rows: LoanRow[] = [];
  const lumpsNotApplied: number[] = [];
  let bal = Pc;
  let tInterest = 0n;
  let tPaid = 0n;
  let tExtra = 0n;
  let tPrincipal = 0n;
  let balloonC = 0;
  const hasBalloon = Bc > 0 || amortN > n;
  const extraC = toCents(inp.extra ?? 0);
  for (let k = 1; k <= n && bal > 0; k++) {
    if (changeAt.has(k) && k > 1) {
      annual = changeAt.get(k)!;
      R = BigInt(Math.round(annual * 1e9));
      const left = n - k + 1;
      const fvC = amortN > n ? 0 : Math.min(Bc, bal);
      pmtC = paymentCents(bal, R, m, amortN > n ? amortN - k + 1 : left, fvC);
      if (!Number.isSafeInteger(pmtC)) return { error: "The payment is not computable for these inputs." };
      // the payment-1 rule at every recast: a re-amortized payment that rounds to no more than that period's interest
      // would go interest-only (or grow the balance) until one huge last payment; refused, naming the change
      const recastInterest = interestCents(bal, R, m);
      // (0.00 against 0.00 interest is allowed when the balloon covers the balance: a change to 0% on an interest-only loan)
      if (k < n && (pmtC < recastInterest || (pmtC === recastInterest && fvC < bal)))
        return {
          error:
            `At the rate change at payment ${k.toLocaleString("en-US")} (${pctText(annual)} a year) the payment re-amortized over the ${(amortN > n ? amortN - k + 1 : left).toLocaleString("en-US")} payments left rounds to ${centsText(pmtC)} a period, ` +
            `no more than that period's interest (${centsText(recastInterest)}) on the balance of ${centsText(bal)}, so rounded to the cent the loan would not amortize from there. ` +
            `Change or remove that rate change${tExtra > 0n ? ", or make smaller extra payments before it" : ""}.`,
        };
      recasts.push({ k, rate: annual, payment: pmtC / 100 });
    }
    const interest = interestCents(bal, R, m);
    let sched = pmtC - interest;
    let pay = pmtC;
    let extra = 0;
    const lumpC = toCents(inp.lumps?.get(k) ?? 0);
    if (k === n || sched >= bal) {
      // the last payment (or a scheduled payment that clears the balance) pays off everything: balance + its interest
      if (k === n && hasBalloon && bal - sched > 0) balloonC = bal - sched;
      if (lumpC > 0) lumpsNotApplied.push(k);
      sched = bal;
      pay = bal + interest;
    } else {
      extra = (extraC > 0 && k >= (inp.extraFrom ?? 1) ? extraC : 0) + lumpC;
      if (extra > bal - sched) extra = bal - sched;
    }
    const principal = sched + extra;
    bal -= principal;
    tInterest += BigInt(interest);
    tPaid += BigInt(pay + extra);
    tExtra += BigInt(extra);
    tPrincipal += BigInt(principal);
    rows.push({
      k,
      rate: annual,
      payment: pay / 100,
      extra: extra / 100,
      interest: interest / 100,
      principal: principal / 100,
      balance: bal / 100,
      c: { payment: pay, extra, interest, principal, balance: bal },
    });
  }
  const MAXC = BigInt(Number.MAX_SAFE_INTEGER);
  if (tPaid > MAXC || tInterest > MAXC) return { error: "The amounts are too large to schedule to the cent." };
  const totalsC = { interest: Number(tInterest), paid: Number(tPaid), extra: Number(tExtra), principal: Number(tPrincipal) };
  return {
    rows,
    payment0,
    recasts,
    totalInterest: totalsC.interest / 100,
    totalPaid: totalsC.paid / 100,
    totalExtra: totalsC.extra / 100,
    totalsC,
    payoffK: rows.length,
    balloonPaid: balloonC / 100,
    lumpsNotApplied,
  };
}
