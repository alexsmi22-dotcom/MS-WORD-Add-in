// Finance calculations for the Finance mode: time value of money, loans,
// discounted cash flow (NPV/IRR), growth, option pricing (Black–Scholes–Merton), and
// bond pricing. Pure numeric functions — no Office.js — fully unit-testable. The
// task pane formats and inserts the results.
//
// Rate conventions: rates are per-period decimals unless a function name says
// otherwise (e.g. compoundInterest takes an annual rate + compounds/year).

import { parseCellNumber } from "./dataimport";
import { normalCdfPrecise } from "./probdist";

/**
 * A Finance number field as typed: the product's one cell reader (true minus
 * "−5", grouping "1,000", decimal comma "3,5", a trailing "%", ×10ⁿ), and a
 * leading "+". NaN for anything else — including "0x10", which Number() read
 * as 16 — so the pane refuses it by name instead of computing with it.
 */
export function readFinanceField(raw: string): number {
  const t = (raw ?? "").trim().replace(/^\+/, "");
  if (!t) return NaN;
  return parseCellNumber(t);
}

/** Future value of a single sum: pv compounded at `rate` for `n` periods. */
export function futureValue(pv: number, rate: number, n: number): number {
  return pv * Math.pow(1 + rate, n);
}

/** Present value of a single future sum. */
export function presentValue(fv: number, rate: number, n: number): number {
  return fv / Math.pow(1 + rate, n);
}

/** Compound interest: principal at annual `rate`, compounded `perYear` times, for `years`. */
export function compoundInterest(principal: number, annualRate: number, perYear: number, years: number): number {
  return principal * Math.pow(1 + annualRate / perYear, perYear * years);
}

/** Continuous compounding: principal at annual `rate` for `years`. */
export function continuousCompound(principal: number, annualRate: number, years: number): number {
  return principal * Math.exp(annualRate * years);
}

/** Level payment for a loan of `principal` at `ratePerPeriod` over `nPeriods`. */
export function loanPayment(principal: number, ratePerPeriod: number, nPeriods: number): number {
  if (nPeriods <= 0) return NaN;
  if (ratePerPeriod === 0) return principal / nPeriods;
  return (principal * ratePerPeriod) / (1 - Math.pow(1 + ratePerPeriod, -nPeriods));
}

/** Present value of an ordinary annuity (level `pmt` for `n` periods at `rate`). */
export function annuityPV(pmt: number, rate: number, n: number): number {
  if (rate === 0) return pmt * n;
  return (pmt * (1 - Math.pow(1 + rate, -n))) / rate;
}

/** Future value of an ordinary annuity. */
export function annuityFV(pmt: number, rate: number, n: number): number {
  if (rate === 0) return pmt * n;
  return (pmt * (Math.pow(1 + rate, n) - 1)) / rate;
}

/** Net present value. cashflows[0] occurs at t=0; `rate` is per period. */
export function npv(rate: number, cashflows: number[]): number {
  let sum = 0;
  for (let t = 0; t < cashflows.length; t++) sum += cashflows[t] / Math.pow(1 + rate, t);
  return sum;
}

/**
 * Internal rate of return — the rate where NPV = 0. Scans the rate range in fine
 * steps to find the first NPV sign change (so it works even when the wide-bracket
 * endpoints share a sign, e.g. unconventional cash flows with multiple sign
 * changes), then bisects to the root. Returns the lowest such rate, or null when
 * no root exists in range. (When a stream has multiple IRRs, the lowest is the
 * conventional choice — the ambiguity is inherent to the IRR metric.)
 */
/**
 * The rate range `irr` scans, and the sentence that names it.
 *
 * A REFUSAL THAT DOES NOT NAME ITS BOUND IS NOT A REFUSAL, IT IS A WRONG ANSWER.
 * The scan used to stop at 10 (1000%), so `irr([-1, 20])` — a 20× return, entirely
 * ordinary in venture cash flows — came back null and the pane printed "IRR = no
 * solution". True IRR: 1900%. The user reads that as "this cash flow has no IRR",
 * which is false. The ceiling is now 100 (10,000%), which covers that case, and it
 * is exported so the surface reporting the refusal can say what was searched
 * instead of implying the mathematics came up empty.
 */
export const IRR_SEARCH_MIN = -0.99;
export const IRR_SEARCH_MAX = 100;

/**
 * The searched range in the words the refusal has to use.
 *
 * DATA, not a function, and deliberately: it is one constant string that belongs
 * beside the two numbers it describes. It is also NOT YET READ by anything — the
 * surface that prints "IRR = no solution" is taskpane.ts, which must append this.
 * Note that the dead-export ratchet in reachability.adversarial.test.ts counts
 * exported FUNCTIONS and const-arrow-functions only, so an unwired string constant
 * is invisible to it: nothing will remind anyone that this is unused. That is
 * exactly the "computed, tested, and never read" shape this release is fixing
 * elsewhere, so it is written down here rather than left to be discovered.
 */
export const IRR_SEARCH_RANGE_TEXT = "−99% to 10,000% per period";
/** XIRR searches an ANNUAL rate over a slightly different interval (findRoot below). */
export const XIRR_SEARCH_RANGE_TEXT = "−99.99% to 10,000% a year";

/**
 * A WIDER RANGE AT THE SAME STEP IS A SLOWER PANE, AND THE SCAN IS SYNCHRONOUS.
 *
 * Widening the ceiling from 10 to 100 at the original 0.5% step multiplies the
 * npv evaluations by ten, and each one is O(cash flows) — a list this field
 * accepts by paste. Measured on an all-positive list (no sign change, so the scan
 * runs to the very end, which is the worst case):
 *
 *     flows      old ceiling 10      ceiling 100 at 0.5%
 *      1,000            151 ms                  1,252 ms
 *      5,000            594 ms                  5,134 ms
 *     20,000          1,999 ms                 14,187 ms
 *
 * Fourteen seconds inside a task pane is not a slow answer, it is Word frozen.
 * So the resolution is spent where it buys something: the original 0.5% step below
 * 1000%, where conventional IRRs live and where the lowest-root convention has to
 * be exact, and 5% above it, where the question is only whether a venture-scale
 * return exists at all. A sign change found on the coarse grid is still bisected
 * to full precision, so the ANSWER is not coarser — only the search for a bracket
 * is. Total iterations are fixed at about 4,000 whatever the cash flows, against
 * 2,200 before and 20,200 at a uniform fine step.
 */
const IRR_FINE_UNTIL = 10;
const IRR_FINE_STEP = 0.005;
const IRR_COARSE_STEP = 0.05;

/**
 * NPV by Horner's rule (fix-fin R1 #2): one multiply-add per flow instead of a Math.pow, for the 4,000-step IRR scan.
 * Measured on 1,000 all-positive flows: 589 ms with npv(), a few ms with this. Same value to rounding; npv() itself is
 * unchanged because it prints.
 */
function npvHorner(rate: number, cashflows: number[]): number {
  const d = 1 / (1 + rate);
  let s = 0;
  for (let t = cashflows.length - 1; t >= 0; t--) s = s * d + cashflows[t];
  return s;
}

export function irr(cashflows: number[]): number | null {
  if (cashflows.length < 2) return null;
  const f = (r: number): number => npvHorner(r, cashflows);
  const start = IRR_SEARCH_MIN;
  const end = IRR_SEARCH_MAX;
  let prevR = start;
  let prevV = f(start);
  if (prevV === 0) return prevR;
  for (let r = start + IRR_FINE_STEP; r <= end + 1e-9; r += r < IRR_FINE_UNTIL ? IRR_FINE_STEP : IRR_COARSE_STEP) {
    const v = f(r);
    if (v === 0) return r;
    if (prevV * v < 0) {
      // Bisect within the bracket that contains the sign change.
      let lo = prevR;
      let hi = r;
      let flo = prevV;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        const fmid = f(mid);
        if (Math.abs(fmid) < 1e-9) return mid;
        if (flo * fmid < 0) hi = mid;
        else {
          lo = mid;
          flo = fmid;
        }
      }
      return (lo + hi) / 2;
    }
    prevR = r;
    prevV = v;
  }
  return null;
}

/** Compound annual growth rate from `begin` to `end` over `years`. */
export function cagr(begin: number, end: number, years: number): number {
  if (begin <= 0 || years <= 0) return NaN;
  return Math.pow(end / begin, 1 / years) - 1;
}

/**
 * Standard normal CDF Φ(x). Since v2.202.0 (gap D1) this is probdist.ts's normalCdfPrecise (erf/erfc, about 1e-16
 * absolute), not the Abramowitz–Stegun 26.2.17 polynomial (about 7.5e-8), which put an S = K = 100, t = 1, r = 5%,
 * σ = 20% call 8.0e-6 low and a K = 200 call 1.7% low. Kept under this name for its callers.
 */
export function normCdf(x: number): number {
  return normalCdfPrecise(x);
}

export type OptionType = "call" | "put";

/**
 * Black–Scholes–Merton price of a European option. t in years; r and q are continuously compounded annual decimals;
 * q is a continuous dividend yield (Merton 1973), default 0 so every existing caller is the no-dividend model.
 */
export function blackScholes(type: OptionType, S: number, K: number, t: number, r: number, sigma: number, q = 0): number {
  if (!(t >= 0) || !(sigma >= 0) || !Number.isFinite(q)) return NaN;
  if (t === 0) return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const pvS = S * Math.exp(-q * t);
  const pvK = K * Math.exp(-r * t);
  if (sigma === 0) {
    // THE DETERMINISTIC LIMIT, not intrinsic value. With no volatility the
    // stock grows at r − q for certain, so the option pays max(S·e^((r−q)t) − K, 0)
    // at expiry; discounted, that is max(S·e^(−qt) − K·e^(−rt), 0). Intrinsic
    // max(S − K, 0) ignored the time value of the strike (a 1-year put, S 90,
    // K 100, r 5% read 10.00 against the true 5.12).
    return type === "call" ? Math.max(pvS - pvK, 0) : Math.max(pvK - pvS, 0);
  }
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  if (type === "call") return pvS * normCdf(d1) - pvK * normCdf(d2);
  return pvK * normCdf(-d2) - pvS * normCdf(-d1);
}

/**
 * Why a maturity is refused, or null when it is priceable.
 *
 * `Math.round(years * freq)` used to hide a partial coupon period: at two coupons
 * a year, 10.25 years (20.5 periods), 10.4 years (20.8) and 10.5 years (21) ALL
 * priced at 922.92. Three different bonds, one price, and nothing said why.
 *
 * Only two of those three are wrong. 10.5 × 2 = 21 exactly, so 10.5 years IS a
 * whole number of coupon periods and must keep working; a refusal that swept it up
 * would break a perfectly ordinary maturity.
 *
 * The other two are refused rather than caveated because pricing them is not a
 * rounding question at all — a bond bought part-way through a coupon period is
 * priced with accrued interest, and "CLEAN price only, accrued interest is not
 * included" is already this module's standing, stated refusal. Rounding to the
 * nearest whole period does not approximate that calculation, it answers a
 * different question and labels it with the user's number.
 */
export const MAX_COUPON_PERIODS = 12000;

export function bondPeriodRefusal(years: number, freq: number): string | null {
  const exact = years * freq;
  // AN UNBOUNDED COUPON LOOP IS A FROZEN WORD, NOT AN ERROR.
  //
  // "Years to maturity" is a free-text field. `periods` was Math.round(years*freq)
  // with only a `< 1` guard, so Infinity — or 1e9, which a fat-fingered entry
  // produces just as easily — walked `for (k = 1; k <= periods; k++)` forever.
  // Measured: neither returns within five million iterations. In a task pane that
  // is not a slow answer, it is a dead Word with the user's work in it.
  // Number.isFinite is not a bound, so there is a number here as well.
  // SIGN AND ZERO, BEFORE ANYTHING ELSE. `exact = years * freq` is the only
  // quantity checked below, and it is a PRODUCT — so two negatives cancelled and
  // sailed through every later test. Measured: bondPrice(1000, 0.05, 0.06, -10,
  // -2) returned a confident 1139.82 for a bond with a negative maturity paying
  // coupons a negative number of times a year. A price for an instrument that
  // cannot exist is the worst thing this module can produce, and it looked
  // entirely ordinary. Zero is refused for the same reason: a bond with no
  // maturity and no coupon dates is not a thing to price.
  if (!Number.isFinite(years) || years <= 0) {
    return "Years to maturity must be a positive number.";
  }
  if (!Number.isFinite(freq) || freq <= 0) {
    return "Coupons per year must be a positive number — 1 (annual), 2 (semiannual), 4 or 12.";
  }
  if (!Number.isFinite(exact)) {
    // NAME THE ARGUMENT THAT IS ACTUALLY BAD, and never interpolate a non-finite
    // number into user-facing text. `bondPeriodRefusal(10, NaN)` used to read
    // "A maturity of 10 years is not a number of coupon periods" — blaming a
    // maturity that was fine — and `(NaN, 2)` put the literal "NaN years" on
    // screen, which the display contract forbids.
    if (!Number.isFinite(freq) || freq <= 0) {
      return "Coupons per year must be a positive number — 1 (annual), 2 (semiannual), 4 or 12.";
    }
    return "Years to maturity must be a positive number.";
  }
  if (exact > MAX_COUPON_PERIODS) {
    return (
      `${years} years at ${freq} coupon${freq === 1 ? "" : "s"} per year is ${exact} coupon periods. ` +
      `This prices at most ${MAX_COUPON_PERIODS} periods — past any instrument that exists, and past what ` +
      `can be summed without stalling. Check the maturity and the coupon frequency.`
    );
  }
  if (Math.abs(exact - Math.round(exact)) <= 1e-9) return null;
  // A REFUSAL IS OUTPUT, AND OUTPUT IS A CONTRACT. Dividing back by freq lands on
  // float noise for any frequency that is not a power of two — at 3 coupons a year
  // the advice read "the nearest whole-period maturities are 2.3333333333333335 and
  // 2.6666666666666665 years", which is not a number anyone types. And the lower
  // suggestion is only usable if it is a real bond: below one whole period there is
  // nothing to price, so it is dropped rather than offered.
  const tidy = (v: number): string => String(Number(v.toPrecision(10)));
  const loPeriods = Math.floor(exact);
  const suggestions = [loPeriods >= 1 ? tidy(loPeriods / freq) : null, tidy(Math.ceil(exact) / freq)]
    .filter((s): s is string => s !== null);
  return (
    `${tidy(years)} years at ${freq} coupon${freq === 1 ? "" : "s"} per year is ${tidy(exact)} coupon ` +
    `periods — a partial period. Settling part-way through a period is an ACCRUED INTEREST calculation, ` +
    `and this reports the clean price only, so no price is given rather than one for a bond you did not ` +
    `describe. ` +
    (suggestions.length === 1
      ? `The nearest whole-period maturity is ${suggestions[0]} year${suggestions[0] === "1" ? "" : "s"}.`
      : `The nearest whole-period maturities are ${suggestions[0]} and ${suggestions[1]} years.`)
  );
}

/**
 * Price of a coupon bond. `couponRate` and `ytm` are annual decimals; coupons pay
 * `freq` times per year for `years`. Returns NaN when the maturity leaves a partial
 * coupon period — see bondPeriodRefusal for the reason, and call it for the text.
 */
export function bondPrice(face: number, couponRate: number, ytm: number, years: number, freq = 2): number {
  if (bondPeriodRefusal(years, freq)) return NaN;
  const periods = Math.round(years * freq);
  if (periods < 1) return NaN;
  const coupon = (face * couponRate) / freq;
  const y = ytm / freq;
  let price = 0;
  for (let k = 1; k <= periods; k++) price += coupon / Math.pow(1 + y, k);
  price += face / Math.pow(1 + y, periods);
  return price;
}

// --- shared robust root-finder ----------------------------------------------

/**
 * Finds a root of `f` in [lo, hi] by scanning for the first sign change in
 * `steps` intervals, then bisecting. Returns null if no sign change is found.
 * Used by the solvers below (YTM, implied vol, XIRR) so they don't depend on a
 * good initial guess.
 */
export function findRoot(f: (x: number) => number, lo: number, hi: number, steps = 1000): number | null {
  let prevX = lo;
  let prevV = f(lo);
  if (prevV === 0) return lo;
  const dx = (hi - lo) / steps;
  for (let i = 1; i <= steps; i++) {
    const x = lo + i * dx;
    const v = f(x);
    if (v === 0) return x;
    if (Number.isFinite(prevV) && Number.isFinite(v) && prevV * v < 0) {
      let a = prevX;
      let b = x;
      let fa = prevV;
      for (let j = 0; j < 200; j++) {
        const mid = (a + b) / 2;
        const fm = f(mid);
        if (Math.abs(fm) < 1e-10 || (b - a) / 2 < 1e-12) return mid;
        if (fa * fm < 0) b = mid;
        else {
          a = mid;
          fa = fm;
        }
      }
      return (a + b) / 2;
    }
    prevX = x;
    prevV = v;
  }
  return null;
}

// --- rate conversions --------------------------------------------------------

/** Effective annual rate from a nominal annual rate compounded `m` times/year. */
export function effectiveAnnualRate(nominalAnnual: number, m: number): number {
  if (m <= 0) return NaN;
  return Math.pow(1 + nominalAnnual / m, m) - 1;
}

/** Nominal annual rate (compounded `m`/year) that gives a given effective rate. */
export function nominalAnnualRate(effective: number, m: number): number {
  if (m <= 0) return NaN;
  return m * (Math.pow(1 + effective, 1 / m) - 1);
}

// --- perpetuities & growing annuities ---------------------------------------

/** Present value of a level perpetuity: pmt / rate. */
export function perpetuity(pmt: number, rate: number): number {
  // rate ≤ 0: Σ pmt/(1+r)^k does not converge (a negative "value" was printed).
  return rate > 0 ? pmt / rate : NaN;
}

/** PV of a growing perpetuity (Gordon): pmt / (rate − g); requires rate > g (and g > −100%). */
export function growingPerpetuity(pmt: number, rate: number, g: number): number {
  return rate <= g || g <= -1 ? NaN : pmt / (rate - g);
}

/** PV of a growing ordinary annuity: first payment `pmt`, growing at g, n periods. */
export function growingAnnuityPV(pmt: number, rate: number, g: number, n: number): number {
  if (n <= 0) return 0;
  if (rate === g) return (pmt * n) / (1 + rate);
  return (pmt / (rate - g)) * (1 - Math.pow((1 + g) / (1 + rate), n));
}

// --- loan amortization -------------------------------------------------------

export interface AmortRow {
  period: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/**
 * Full amortization schedule for a loan: level payment each period, split into
 * interest and principal, with the running balance. The final payment is
 * adjusted so the balance lands exactly on zero (absorbing rounding drift).
 */
/**
 * The longest schedule this will build. 12,000 periods is a thousand years of
 * monthly payments — past any real loan, and small enough to render.
 */
export const MAX_AMORT_PERIODS = 12000;

export interface AmortSummary {
  payment: number;
  totalPaid: number;
  totalInterest: number;
}

/**
 * Loan totals in CLOSED FORM, with no schedule and so no period cap.
 *
 * The summary calculator used to sum amortizationSchedule rows, and that
 * schedule silently stops at MAX_AMORT_PERIODS: a 40-year daily loan (14,600
 * periods) was summarised as a different, 12,000-period loan. Payment =
 * P·i/(1 − (1+i)^−N); total paid = N·payment; interest = total − P.
 * numpy-financial: npf.pmt(0.05/365, 14600, −200000) = 31.686094…,
 * ×14600 − 200000 = 262,616.9757.
 */
export function amortizationSummary(principal: number, ratePerPeriod: number, nPeriods: number): AmortSummary {
  const payment = loanPayment(principal, ratePerPeriod, nPeriods);
  const totalPaid = payment * nPeriods;
  return { payment, totalPaid, totalInterest: totalPaid - principal };
}

/**
 * Row k (1-based) of the level-payment schedule in closed form, for thinned
 * figures of loans of any length: balance after k payments is
 * P(1+i)^k − pmt·((1+i)^k − 1)/i.
 */
export function amortizationRowAt(principal: number, ratePerPeriod: number, nPeriods: number, k: number): AmortRow {
  const pmt = loanPayment(principal, ratePerPeriod, nPeriods);
  const i = ratePerPeriod;
  const bal = (j: number): number =>
    i === 0 ? principal - pmt * j : principal * Math.pow(1 + i, j) - (pmt * (Math.pow(1 + i, j) - 1)) / i;
  const before = bal(k - 1);
  const interest = before * i;
  const balance = k >= nPeriods ? 0 : Math.max(0, bal(k));
  return { period: k, payment: pmt, interest, principal: pmt - interest, balance };
}

export function amortizationSchedule(principal: number, ratePerPeriod: number, nPeriods: number): AmortRow[] {
  const rows: AmortRow[] = [];
  // `nPeriods <= 0` does not reject Infinity, and `k <= Infinity` never ends —
  // so a large enough "Years" in the pane froze Word outright, with no error and
  // no way back. A bound belongs here, not only at the call site.
  if (!Number.isFinite(nPeriods) || nPeriods <= 0) return rows;
  nPeriods = Math.min(Math.floor(nPeriods), MAX_AMORT_PERIODS);
  const pmt = loanPayment(principal, ratePerPeriod, nPeriods);
  let balance = principal;
  for (let k = 1; k <= nPeriods; k++) {
    const interest = balance * ratePerPeriod;
    let princ = pmt - interest;
    let payment = pmt;
    if (k === nPeriods) {
      // Absorb rounding: last payment clears the remaining balance exactly.
      princ = balance;
      payment = balance + interest;
    }
    balance = Math.max(0, balance - princ);
    rows.push({ period: k, payment, interest, principal: princ, balance });
  }
  return rows;
}

// --- discounted cash flow (with Gordon terminal value) ----------------------

/**
 * DCF valuation. `flows[i]` occurs at t = i+1 (first flow one period out). If
 * `terminalGrowth` is given, a Gordon terminal value on the last flow —
 * flowₙ·(1+g)/(rate−g) — is added and discounted from period n.
 */
export function dcf(rate: number, flows: number[], terminalGrowth?: number): number {
  let pv = 0;
  for (let i = 0; i < flows.length; i++) pv += flows[i] / Math.pow(1 + rate, i + 1);
  if (terminalGrowth !== undefined && flows.length) {
    if (rate <= terminalGrowth) return NaN;
    const last = flows[flows.length - 1];
    const tv = (last * (1 + terminalGrowth)) / (rate - terminalGrowth);
    pv += tv / Math.pow(1 + rate, flows.length);
  }
  return pv;
}

// --- date-based NPV / IRR (irregular cash flows) ----------------------------

/** XNPV: cash flows on arbitrary dates. `days[i]` = days from the first date; annual `rate`. */
export function xnpv(rate: number, cashflows: number[], days: number[]): number {
  let sum = 0;
  for (let i = 0; i < cashflows.length; i++) sum += cashflows[i] / Math.pow(1 + rate, days[i] / 365);
  return sum;
}

/** XIRR: annual IRR for cash flows on arbitrary dates (days from the first flow). */
export function xirr(cashflows: number[], days: number[]): number | null {
  if (cashflows.length < 2) return null;
  return findRoot((r) => xnpv(r, cashflows, days), -0.9999, 100, 2000);
}

// --- bond analytics ----------------------------------------------------------

/**
 * Yield to maturity that prices a coupon bond at `price` (annual, or null).
 *
 * ROUNDS THE MATURITY TO WHOLE PERIODS, deliberately, and does NOT inherit
 * bondPrice's partial-period refusal.
 *
 * bondPrice returns NaN for a partial period, so a YTM search over it found no
 * root and returned null for every fractional maturity — 10.25y/2 and 3.5y/1
 * went from a correct 5.637% and 6.458% to "no solution". That reads as "the
 * mathematics came up empty" for input the tool priced fine yesterday, which is
 * the wrong-refusal shape bondPeriodRefusal exists to prevent, not an instance
 * of it. The pane compounds it: its insertability gate blocks any text
 * containing "no solution", so Insert died too.
 *
 * The two cases genuinely differ. A partial period is refused for PRICE because
 * the clean price omits accrued interest and quoting it would answer a question
 * the user did not ask. A YIELD is a rate, and the honest whole-period yield is
 * a useful answer; the caller (and bondPeriodRefusal) still say what was
 * assumed. Non-finite and absurd inputs are refused here as everywhere.
 */
export function bondYTM(price: number, face: number, couponRate: number, years: number, freq = 2): number | null {
  if (price <= 0) return null;
  if (!(years > 0) || !(freq > 0)) return null;
  const exact = years * freq;
  if (!Number.isFinite(exact) || exact < 1 || exact > MAX_COUPON_PERIODS) return null;
  const periods = Math.round(exact);
  // CLOSED FORM inside the search (fix-fin R1 #2): bondPrice sums `periods` Math.pow terms, and the 3,000-step scan
  // over it took 2.3 to 2.8 s at 12,000 periods. The annuity formula is the same price to rounding in O(1).
  const coupon = (face * couponRate) / freq;
  const priceAt = (ytm: number): number => {
    const y = ytm / freq;
    const disc = Math.pow(1 + y, -periods);
    const annuity = y === 0 ? periods : (1 - disc) / y;
    return coupon * annuity + face * disc;
  };
  return findRoot((y) => priceAt(y) - price, -0.99, 2, 3000);
}

export interface BondRisk {
  price: number;
  /** Macaulay duration in years. */
  macaulay: number;
  /** Modified duration in years (% price change per 1.00 change in yield). */
  modified: number;
  /** Convexity in years². */
  convexity: number;
}

/**
 * Price, Macaulay/modified duration, and convexity of a coupon bond. Refuses a
 * partial coupon period on the same grounds as bondPrice — see bondPeriodRefusal.
 */
export function bondAnalytics(face: number, couponRate: number, ytm: number, years: number, freq = 2): BondRisk {
  if (bondPeriodRefusal(years, freq)) return { price: NaN, macaulay: NaN, modified: NaN, convexity: NaN };
  const periods = Math.round(years * freq);
  if (periods < 1) return { price: NaN, macaulay: NaN, modified: NaN, convexity: NaN };
  const coupon = (face * couponRate) / freq;
  const y = ytm / freq;
  let price = 0;
  let weighted = 0;
  let conv = 0;
  for (let k = 1; k <= periods; k++) {
    const cf = coupon + (k === periods ? face : 0);
    const pv = cf / Math.pow(1 + y, k);
    price += pv;
    weighted += (k / freq) * pv;
    conv += pv * k * (k + 1);
  }
  const macaulay = weighted / price;
  const modified = macaulay / (1 + y);
  const convexity = conv / (price * Math.pow(1 + y, 2) * freq * freq);
  return { price, macaulay, modified, convexity };
}

// --- option Greeks & implied volatility -------------------------------------

/** Standard normal PDF. */
function normPdf(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

export interface Greeks {
  /** ∂price/∂S. */
  delta: number;
  /** ∂²price/∂S². */
  gamma: number;
  /** ∂price/∂σ, per 1.00 (100%) change in volatility. */
  vega: number;
  /** −∂price/∂(time to expiry), per year (negative = time decay). */
  theta: number;
  /** ∂price/∂r, per 1.00 change in rate. */
  rho: number;
  /** ∂price/∂q, per 1.00 change in the dividend yield (QuantLib's dividendRho). */
  psi: number;
}

/**
 * Black–Scholes–Merton Greeks for a European option; q is a continuous dividend yield (default 0, the no-dividend
 * model every existing caller gets).
 */
export function blackScholesGreeks(type: OptionType, S: number, K: number, t: number, r: number, sigma: number, q = 0): Greeks {
  const none = { delta: NaN, gamma: NaN, vega: NaN, theta: NaN, rho: NaN, psi: NaN };
  if (!(t > 0) || !(sigma >= 0) || !(S > 0) || !(K > 0) || !Number.isFinite(q)) return none;
  const eq = Math.exp(-q * t);
  if (sigma === 0) {
    // The σ → 0 limit: d1 = d2 = ±∞ by the sign of ln(S/K) + (r − q)t, so N(d)
    // is 0 or 1 and φ(d) = 0 — delta is a step, gamma and vega vanish, theta and
    // rho are those of the forward max(S·e^(−qt) − K·e^(−rt), 0). EXACTLY at the
    // money forward (S·e^(−qt) = K·e^(−rt)) the step is the point itself: delta
    // jumps and gamma is infinite, so nothing is returned (sigmaZeroAtForward names it).
    const m = Math.log(S / K) + (r - q) * t;
    if (Math.abs(m) <= 1e-12 * Math.max(1, Math.abs((r - q) * t))) return none;
    const n1 = m > 0 ? 1 : 0;
    const disc0 = K * Math.exp(-r * t);
    const pvS0 = S * eq;
    return {
      delta: type === "call" ? eq * n1 : eq * (n1 - 1),
      gamma: 0,
      vega: 0,
      theta: type === "call" ? (q * pvS0 - r * disc0) * n1 : (r * disc0 - q * pvS0) * (1 - n1),
      rho: type === "call" ? t * disc0 * n1 : -t * disc0 * (1 - n1),
      psi: type === "call" ? -t * pvS0 * n1 : t * pvS0 * (1 - n1),
    };
  }
  const sqt = Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * t) / (sigma * sqt);
  const d2 = d1 - sigma * sqt;
  const pdf = normPdf(d1);
  const disc = K * Math.exp(-r * t);
  const pvS = S * eq;
  const delta = type === "call" ? eq * normCdf(d1) : -eq * normCdf(-d1);
  const gamma = (eq * pdf) / (S * sigma * sqt);
  const vega = pvS * pdf * sqt;
  const theta =
    type === "call"
      ? (-pvS * pdf * sigma) / (2 * sqt) + q * pvS * normCdf(d1) - r * disc * normCdf(d2)
      : (-pvS * pdf * sigma) / (2 * sqt) - q * pvS * normCdf(-d1) + r * disc * normCdf(-d2);
  const rho = type === "call" ? t * disc * normCdf(d2) : -t * disc * normCdf(-d2);
  const psi = type === "call" ? -t * pvS * normCdf(d1) : t * pvS * normCdf(-d1);
  return { delta, gamma, vega, theta, rho, psi };
}

/** True when σ = 0 and S·e^(−qt) = K·e^(−rt): the Greeks' σ → 0 limit has its step exactly here (undefined). */
export function sigmaZeroAtForward(S: number, K: number, t: number, r: number, sigma: number, q = 0): boolean {
  if (sigma !== 0 || !(t > 0) || !(S > 0) || !(K > 0) || !Number.isFinite(q)) return false;
  const m = Math.log(S / K) + (r - q) * t;
  return Math.abs(m) <= 1e-12 * Math.max(1, Math.abs((r - q) * t));
}

/** Implied volatility from an observed option `price` (annual decimal, or null); q as in blackScholes (default 0). */
export function impliedVolatility(type: OptionType, price: number, S: number, K: number, t: number, r: number, q = 0): number | null {
  if (price <= 0 || t <= 0) return null;
  return findRoot((sig) => blackScholes(type, S, K, t, r, sig, q) - price, 1e-4, 5, 2000);
}

// --- depreciation ------------------------------------------------------------

/** Straight-line depreciation per year: (cost − salvage) / life. */
export function straightLineDepreciation(cost: number, salvage: number, life: number): number {
  if (life <= 0) return NaN;
  return (cost - salvage) / life;
}

export interface DepRow {
  year: number;
  depreciation: number;
  bookValue: number;
}

/**
 * Declining-balance depreciation schedule (double-declining by default). Each
 * year takes `factor/life` of the book value, never depreciating below salvage.
 */
export function decliningBalanceSchedule(cost: number, salvage: number, life: number, factor = 2): DepRow[] {
  const rows: DepRow[] = [];
  // Same shape as amortizationSchedule: `life <= 0` does not reject Infinity,
  // and `year <= Infinity` never ends. A depreciation life is in years.
  if (!Number.isFinite(life) || life <= 0) return rows;
  // A FRACTIONAL LIFE IS KEPT. It used to be floored (7.5 → 7), so the rate was
  // 2/7 instead of 2/7.5 and the last half-year vanished. Now the rate is
  // factor/life and a final part year takes its fraction of a full year's
  // charge, as straight line does.
  const whole = Math.min(Math.floor(life), MAX_AMORT_PERIODS);
  const fraction = life > MAX_AMORT_PERIODS ? 0 : life - Math.floor(life);
  let book = cost;
  const rate = factor / life;
  const step = (year: number, share: number): void => {
    let dep = book * rate * share;
    if (book - dep < salvage) dep = Math.max(0, book - salvage);
    book -= dep;
    rows.push({ year, depreciation: dep, bookValue: book });
  };
  for (let year = 1; year <= whole; year++) step(year, 1);
  if (fraction > 1e-9) step(whole + 1, fraction);
  return rows;
}

// --- return statistics -------------------------------------------------------

/** Arithmetic mean. */
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Sample standard deviation (n − 1 denominator). */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Annualized (geometric) return from a series of per-period returns (decimals). */
export function annualizedReturn(returns: number[], periodsPerYear: number): number {
  if (!returns.length) return NaN;
  const growth = returns.reduce((a, r) => a * (1 + r), 1);
  return Math.pow(growth, periodsPerYear / returns.length) - 1;
}

/** Annualized volatility: sample stdev of per-period returns × √periodsPerYear. */
export function annualizedVolatility(returns: number[], periodsPerYear: number): number {
  return stdev(returns) * Math.sqrt(periodsPerYear);
}

/** Annualized Sharpe ratio from per-period returns and a per-period risk-free rate. */
export function sharpeRatio(returns: number[], riskFreePerPeriod: number, periodsPerYear: number): number {
  const excess = returns.map((r) => r - riskFreePerPeriod);
  const sd = stdev(returns);
  if (!sd) return NaN;
  return (mean(excess) / sd) * Math.sqrt(periodsPerYear);
}
