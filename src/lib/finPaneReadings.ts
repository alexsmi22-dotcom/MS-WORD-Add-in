/**
 * The plain-language readings of the Finance calculators written inside taskpane.ts (FIN_CALCS), "fully inclusive"
 * (2026-10-28). lib/calcReading.ts states the rules; readingProblems(reading) is [] for every reading built here.
 *
 * WHY HERE. Nothing can import taskpane.ts in a test, so each pane entry makes ONE call into this module and the
 * sentences are tested from here. Each builder recomputes from the engine the pane entry calls (lib/finance.ts,
 * lib/patentDamages.ts, lib/lostEarnings.ts) or reads the cells of the result the pane entry already holds (the
 * interest calculators and currency conversion, whose engines print through their own formatters), so the numbers
 * are this run's and are printed with the formatter the text and tables use.
 *
 * WHAT A READING ECHOES. The headline numbers are the result's own, in the text's or table's formatting. The inputs
 * a sentence needs to mean anything ("receiving 1,000.00 in 10 periods is worth 613.91 today at 5%") are echoed:
 * an amount with finMoney, a typed rate or price AS TYPED (inPct / inNum, up to 6 decimals; fix-fin R1 #5: "6.875%"
 * was printed "6.88%"), so a rate in a reading need not appear in the one-line text; a free-text input (a date typed,
 * a period label) is never echoed unless it reads as a date and the result prints it as typed.
 *
 * BRANCHES FOLLOW THE PRINTED VALUE. A bond that prices at 999.9999 prints "1,000.00" and is read as at par, not as a
 * discount; an NPV that prints "0.00" breaks even. A builder returns undefined (no reading) when a number it needs
 * is not finite: the pane then shows the text alone, as before.
 */
import {
  amortizationSummary,
  annuityFV,
  annuityPV,
  bondAnalytics,
  bondPrice,
  bondYTM,
  blackScholes,
  blackScholesGreeks,
  cagr,
  compoundInterest,
  continuousCompound,
  dcf,
  decliningBalanceSchedule,
  effectiveAnnualRate,
  futureValue,
  growingAnnuityPV,
  growingPerpetuity,
  impliedVolatility,
  irr,
  loanPayment,
  nominalAnnualRate,
  npv,
  perpetuity,
  presentValue,
  sharpeRatio,
  annualizedReturn,
  annualizedVolatility,
  straightLineDepreciation,
  xirr,
  type OptionType,
} from "./finance";
import { finFixed, finMoney, finPct } from "./financeFigures";
import {
  computeLostProfits,
  computeRoyalty,
  dmgMoney,
  dmgNum,
  dmgPct,
  dmgQty,
  dmgUnitMoney,
  roundCents,
  GEORGIA_PACIFIC_FACTORS,
  PANDUIT_FACTORS,
  type LostProfitsInput,
  type RoyaltyInput,
} from "./patentDamages";
import { longDate, parseDateField, ratePct, METHOD_WORDS, type InterestMethod } from "./damagesInterest";
import { usd } from "./damagesUsd";
import { READING_MAX } from "./calcReading";

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------------------------

const finite = (...xs: number[]): boolean => xs.every(Number.isFinite);

/** A count or an input number as typed: grouped, at most six decimals, true minus ("10", "7.5", "1,000"). */
export function inNum(x: number): string {
  const s = x.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return s.startsWith("-") ? (/[1-9]/.test(s) ? "−" + s.slice(1) : s.slice(1)) : s;
}

const plural = (n: number, one: string, many = one + "s"): string => (n === 1 ? one : many);

/** A compounding or payment frequency as the pane's titles print it ("12×"): unrounded, never "12.00". */
const timesText = (m: number): string => `${m.toLocaleString("en-US", { maximumFractionDigits: 12 })}×`;

/** True when the printed money text is negative (a true minus) or zero to the cent. */
const isNegText = (s: string): boolean => s.startsWith("−");
const isZeroText = (s: string): boolean => !/[1-9]/.test(s);

/**
 * "a" or "an" before a printed number, as it is read aloud: an 8.00%, an 11.00%, an 18%, an 11,000 (eleven
 * thousand), an 80%; a 5.00%, a 110%, a −5.00% (a minus).
 */
export function aAn(numberText: string, capital = false): string {
  const an = /^(?:8|1[18](?!\d))/.test(numberText);
  return capital ? (an ? "An" : "A") : an ? "an" : "a";
}

/** The longest reading that still keeps the rules: drop the optional second sentence when the whole is too long. */
function fit(first: string, second?: string): string {
  if (second && `${first} ${second}`.length <= READING_MAX) return `${first} ${second}`;
  return first;
}

/** A result with its reading attached, when it is not a refusal and there is one. */
export function withReading<T extends { text: string; ok?: boolean }>(out: T, reading: string | undefined): T & { reading?: string } {
  if (out.ok === false || !reading) return out;
  return { ...out, reading };
}

/**
 * A rate or percentage input as typed (fix-fin R1 #5): "6.875%", "5%", "−2.5%", never rounded to 2 decimals. The input
 * is echoed, not a result, so it is shown the way the reader typed it.
 */
export function inPct(pct: number): string {
  return `${inNum(pct)}%`;
}

// ---------------------------------------------------------------------------------------------------------------
// Refusals the pane entries call (fix-fin): each names the field and says why, in plain words.
// ---------------------------------------------------------------------------------------------------------------

/**
 * A number of periods or years (fv, pv, compound): a number, never negative (R1 #7). Zero is allowed and read in its
 * own sentence. `minOne` is for a payment stream (annuity, growing annuity): it needs at least one payment.
 */
export function periodCountRefusal(n: number, field: string, payments = false): string | undefined {
  if (!Number.isFinite(n)) return `${field} must be a number.`;
  if (payments && !(n > 0)) return `${field} must be above zero: a stream of payments needs at least one payment.`;
  if (n < 0) return `${field} cannot be negative: it counts time forward from today.`;
  return undefined;
}

/** returns (R1 #1, #8): periods a year positive, the risk-free rate a number, two or more returns that vary. */
export function returnsRefusal(rets: number[], ppy: number, rfPct: number): string | undefined {
  if (!Number.isFinite(ppy) || ppy <= 0) {
    return "Periods / year must be a positive number (12 for monthly returns, 52 for weekly): it scales the returns to a year.";
  }
  if (!Number.isFinite(rfPct)) return "Risk-free % / period must be a number.";
  if (rets.length < 2) return "Enter at least two returns: the volatility and the Sharpe ratio need a spread of returns to measure.";
  if (rets.every((x) => x === rets[0])) {
    return "The returns do not vary (every one is the same), so the volatility is zero and the Sharpe ratio is undefined: enter the actual series.";
  }
  return undefined;
}

/** ear (R1 #8): the compounding frequency must be a positive number. */
export function earRefusal(nomPct: number, m: number): string | undefined {
  if (!Number.isFinite(nomPct)) return "Nominal annual rate % must be a number.";
  if (!Number.isFinite(m) || m <= 0) return "Compounds / year must be a positive number: interest has to be added at least once for there to be an effective rate.";
  if (!Number.isFinite(effectiveAnnualRate(nomPct / 100, m))) {
    return "This nominal rate has no effective rate at that frequency: each compounding period would lose more than everything.";
  }
  return undefined;
}

/** irr (R1 #2): the cash-flow list is capped so the root search stays quick. */
export const IRR_MAX_FLOWS = 1000;
export function irrFlowsRefusal(flows: number[]): string | undefined {
  if (flows.length > IRR_MAX_FLOWS) {
    return `The cash flows field holds ${flows.length.toLocaleString("en-US")} flows: this calculator takes at most ${IRR_MAX_FLOWS.toLocaleString("en-US")}, because the rate search runs over every flow.`;
  }
  return undefined;
}

/** Past this size a DCF value is not a valuation but an overflow of the inputs (R3 M7). */
const DCF_MAX = 1e15;

/** dcf (R3 M7): no em dash in the refusal, a discount rate above growth, at least one flow, and a magnitude cap. */
export function dcfRefusal(ratePct: number, flows: number[], gPct: number): string | undefined {
  if (!Number.isFinite(ratePct)) return "Discount rate % / period must be a number.";
  if (!Number.isFinite(gPct)) return "Terminal growth % / period must be a number.";
  if (!flows.length) return "Enter at least one cash flow.";
  if (ratePct <= -100) return "Discount rate % / period must be above −100%.";
  if (ratePct <= gPct) {
    return "The discount rate must be above the terminal growth rate: at or below it the terminal value grows without limit, so there is no value to report.";
  }
  if (flows.some((c) => Math.abs(c) > DCF_MAX)) return "A cash flow is larger than 10¹⁵ in size, which is outside this calculator.";
  const v = dcf(ratePct / 100, flows, gPct / 100);
  if (!Number.isFinite(v) || Math.abs(v) > DCF_MAX) {
    return "The value comes to more than 10¹⁵ in size: the terminal growth rate is too close to the discount rate for the result to mean anything.";
  }
  return undefined;
}

/** Longest life the inline depreciation calculators schedule, as Depreciation schedule (R3 M1). */
export const DEPR_MAX_LIFE = 100;

/** depr and depr-sl (R3 M1, M5): cost above zero, salvage zero or more and not above cost, life above zero up to 100 years. */
export function deprRefusal(cost: number, salvage: number, life: number, factor?: number): string | undefined {
  if (!Number.isFinite(cost) || cost <= 0) return "Cost must be a number above zero.";
  if (!Number.isFinite(salvage) || salvage < 0) return "Salvage value must be zero or more: an asset cannot be sold for less than nothing.";
  if (salvage > cost) return "Salvage value cannot exceed the cost (the asset would appreciate, not depreciate).";
  if (!Number.isFinite(life) || life <= 0) return "Useful life must be a positive number of years.";
  if (life > DEPR_MAX_LIFE) return `Useful life must be at most ${DEPR_MAX_LIFE} years, as in Depreciation schedule.`;
  if (factor !== undefined && !(Number.isFinite(factor) && factor > 0)) return "The factor must be positive (2 = double declining).";
  return undefined;
}

/** How the value moved from `from` to `to` (both as printed). */
function moved(fromText: string, toText: string, from: number, to: number): string {
  if (fromText === toText) return "stays at";
  return Math.abs(to) > Math.abs(from) ? "grows to" : "shrinks to";
}

// ---------------------------------------------------------------------------------------------------------------
// Time value & loans
// ---------------------------------------------------------------------------------------------------------------

/** fv: "1,000.00 left at 5.00% a period grows to 1,628.89 after 10 periods." */
export function fvReading(pv: number, ratePct: number, n: number): string | undefined {
  const r = ratePct / 100;
  const v = futureValue(pv, r, n);
  if (!finite(pv, r, n, v)) return undefined;
  const vs = finMoney(v);
  const ps = finMoney(pv);
  // Zero periods (fix-fin R1 #7): no time passes, so nothing compounds, whatever the rate.
  if (n === 0) return `With 0 periods there is no time to compound, so ${ps} today stays ${vs}.`;
  const verb = moved(ps, vs, pv, v);
  return (
    `Left to compound at ${inPct(ratePct)} a period, ${ps} today ${verb} ${vs} after ${inNum(n)} ${plural(n, "period")}` +
    (verb === "grows to" && r > 0 && n > 1 ? ", because each period's interest also earns interest." : ".")
  );
}

/** pv: "Receiving 1,000.00 in 10 periods is worth 613.91 today at 5% a period." */
export function pvReading(fv: number, ratePct: number, n: number): string | undefined {
  const r = ratePct / 100;
  const v = presentValue(fv, r, n);
  if (!finite(fv, r, n, v)) return undefined;
  const vs = finMoney(v);
  const fs = finMoney(fv);
  // Zero periods (fix-fin R1 #7): the money arrives now, so it is not "no discounting at this rate".
  if (n === 0) return `Receiving ${fs} now, in 0 periods, is worth ${vs} today: with no wait there is nothing to discount.`;
  const head = `Receiving ${fs} in ${inNum(n)} ${plural(n, "period")} is worth ${vs} today at ${inPct(ratePct)} a period`;
  if (isZeroText(fs)) return `${head}.`;
  if (vs === fs) {
    return r === 0
      ? `${head}: with no discounting, money later is worth the same as money now.`
      : `${head}: at this rate the discount is too small to show to the cent.`;
  }
  if (Math.abs(v) < Math.abs(fv)) return `${head}, the most it makes sense to pay for it now if you require that return.`;
  return `${head}: at a negative rate, money later is worth more than the same sum now.`;
}

/** compound: "At 5.00% a year compounded 12× a year, 1,000.00 grows to 1,647.01 after 10 years." */
export function compoundReading(p: number, ratePct: number, m: number, years: number): string | undefined {
  const r = ratePct / 100;
  const v = compoundInterest(p, r, m, years);
  if (!finite(p, r, m, years, v) || !(m > 0)) return undefined;
  const vs = finMoney(v);
  const ps = finMoney(p);
  if (years === 0) return `With 0 years there is no time to compound, so ${ps} stays ${vs}.`;
  return `At ${inPct(ratePct)} a year compounded ${timesText(m)} a year, ${ps} ${moved(ps, vs, p, v)} ${vs} after ${inNum(years)} ${plural(years, "year")}.`;
}

const FREQ_WORDS: Record<number, string> = { 1: "annual", 2: "half-yearly", 4: "quarterly", 12: "monthly", 26: "fortnightly", 52: "weekly", 365: "daily" };

/** The payment noun for m payments a year ("monthly payment", or "payment (12.5 a year)"). */
const paymentNoun = (m: number): string => (FREQ_WORDS[m] ? `${FREQ_WORDS[m]} payment` : `payment (${inNum(m)} a year)`);

/** loan: "Each monthly payment of 1,073.64 repays 200,000.00 borrowed at 5.00% a year over 30 years." */
export function loanReading(p: number, ratePct: number, years: number, m: number): string | undefined {
  const n = Math.round(years * m);
  const i = ratePct / 100 / m;
  const pay = loanPayment(p, i, n);
  if (!finite(p, i, n, pay) || !(n >= 1)) return undefined;
  const first =
    `Each ${paymentNoun(m)} of ${finMoney(pay)} repays ${finMoney(p)} borrowed at ${inPct(ratePct)} a year ` +
    `over ${inNum(years)} ${plural(years, "year")}.`;
  // Only when it is true: the first payment more than half interest (a 15-year loan at 3% is not).
  return fit(first, i > 0 && n > 1 && p > 0 && p * i > pay / 2 ? "Early payments are mostly interest, so the balance falls slowly at first." : undefined);
}

/** amort: "Each monthly payment is 1,073.64; over 30 years that is 186,511.57 of interest on top of the 200,000.00 borrowed." */
export function amortReading(p: number, ratePct: number, years: number, m: number): string | undefined {
  const n = Math.round(years * m);
  const s = amortizationSummary(p, ratePct / 100 / m, n);
  if (!finite(p, s.payment, s.totalInterest, s.totalPaid)) return undefined;
  const ti = finMoney(s.totalInterest);
  const head = `Each ${paymentNoun(m)} is ${finMoney(s.payment)}; over ${inNum(years)} ${plural(years, "year")} that is`;
  if (isZeroText(ti)) return `${head} no interest at all: the ${finMoney(p)} borrowed is repaid exactly.`;
  if (isNegText(ti) || p < 0) return `${head} ${finMoney(s.totalPaid)} paid in total for the ${finMoney(p)} borrowed.`;
  return `${head} ${ti} of interest on top of the ${finMoney(p)} borrowed.`;
}

/** ear: "A 12.00% nominal rate compounded 12× a year is 12.68% a year effective, because interest earns interest within the year." */
export function earReading(nomPct: number, m: number): string | undefined {
  const nom = nomPct / 100;
  const eff = effectiveAnnualRate(nom, m);
  if (!finite(nom, m, eff)) return undefined;
  const es = finPct(eff);
  // The nominal rate as typed (R1 #5); the branch compares the two at the effective rate's printed precision.
  const ns = inPct(nomPct);
  if (es === finPct(nom)) {
    return m === 1
      ? `${aAn(ns, true)} ${ns} nominal rate compounded once a year is also ${es} effective: no interest is earned on interest within the year.`
      : `${aAn(ns, true)} ${ns} nominal rate compounded ${timesText(m)} a year is ${es} effective to two decimals: compounding within the year adds too little to show.`;
  }
  return `${aAn(ns, true)} ${ns} nominal rate compounded ${timesText(m)} a year is ${es} a year effective` + (eff > nom && nom > 0 ? ", because interest earns interest within the year." : ".");
}

/** gann: "A first payment of 1,000.00, growing 5.00% a period for 10 periods, is worth 8,108.07 today at a 10.00% discount rate." */
export function gannReading(pmt: number, ratePct: number, gPct: number, n: number): string | undefined {
  const r = ratePct / 100;
  const g = gPct / 100;
  const v = growingAnnuityPV(pmt, r, g, n);
  if (!finite(pmt, r, g, n, v)) return undefined;
  return (
    `A first payment of ${finMoney(pmt)} at the end of the first period, changing by ${inPct(gPct)} each period for ${inNum(n)} ${plural(n, "period")}, ` +
    `is worth ${finMoney(v)} today at ${aAn(inPct(ratePct))} ${inPct(ratePct)} discount rate.`
  );
}

/** annuity: "20 payments of 1,000.00 at 5.00% a period are worth 12,462.21 today, or 33,065.95 at the last payment, against 20,000.00 paid in." */
export function annuityReading(pmt: number, ratePct: number, n: number): string | undefined {
  const r = ratePct / 100;
  const pv = annuityPV(pmt, r, n);
  const fv = annuityFV(pmt, r, n);
  if (!finite(pmt, r, n, pv, fv)) return undefined;
  return (
    `${inNum(n)} ${plural(n, "payment")} of ${finMoney(pmt)} at ${inPct(ratePct)} a period ${n === 1 ? "is" : "are"} worth ${finMoney(pv)} today, ` +
    `or ${finMoney(fv)} at the last payment, against ${finMoney(pmt * n)} paid in.`
  );
}

/** perpetuity: level and growing values. The pane refuses growth at or above the rate and a rate at or below zero. */
export function perpetuityReading(pmt: number, ratePct: number, gPct: number): string | undefined {
  const r = ratePct / 100;
  const g = gPct / 100;
  const level = perpetuity(pmt, r);
  const growing = growingPerpetuity(pmt, r, g);
  if (!finite(pmt, r, g, level, growing)) return undefined;
  // R1 #13: plain order; the rates as typed (R1 #5).
  const first = `A payment of ${finMoney(pmt)} every period forever, starting next period, is worth ${finMoney(level)} today at ${aAn(inPct(ratePct))} ${inPct(ratePct)} discount rate`;
  if (g === 0) return `${first}; with no growth that is also the growing value.`;
  return `${first}; changing by ${inPct(gPct)} a period it is worth ${finMoney(growing)}, a value sensitive to the growth assumed.`;
}

/** rate-forms: discrete against continuous compounding, and the effective rate. */
export function rateFormsReading(p: number, ratePct: number, years: number, m: number): string | undefined {
  const rate = ratePct / 100;
  const cont = continuousCompound(p, rate, years);
  const disc = p * Math.pow(1 + rate / m, m * years);
  const eff = effectiveAnnualRate(rate, m);
  const nominal = nominalAnnualRate(eff, m);
  if (!finite(p, rate, years, m, cont, disc, eff, nominal) || !(m > 0)) return undefined;
  const cs = finMoney(cont);
  const ds = finMoney(disc);
  // The larger amount is the most any compounding gives (e^r ≥ (1 + r/m)^m, so continuous for a positive principal).
  const bound = cs === ds ? "the same" : cont > disc ? "the most any compounding can give" : "the least any compounding can give";
  return (
    `At ${inPct(ratePct)} for ${inNum(years)} ${plural(years, "year")}, ${finMoney(p)} becomes ${ds} compounded ${timesText(m)} a year and ${cs} compounded ` +
    `continuously (${bound}); ${inPct(ratePct)} nominal is ${finPct(eff)} effective.`
  );
}

/** cagr: "Growing from 10,000.00 to 18,000.00 over 5 years is the same as a steady 12.47% a year." */
export function cagrReading(begin: number, end: number, years: number): string | undefined {
  const g = cagr(begin, end, years);
  if (!finite(begin, end, years, g)) return undefined;
  const gs = finPct(g);
  const span = `from ${finMoney(begin)} to ${finMoney(end)} over ${inNum(years)} ${plural(years, "year")}`;
  if (isZeroText(gs)) return `Going ${span} is essentially no growth: a steady ${gs} a year.`;
  if (end === 0) return `Going ${span} is a total loss: ${gs} a year.`;
  return `${g > 0 ? "Growing" : "Falling"} ${span} is the same as a steady ${gs} a year, though the actual path may have been bumpier.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Capital budgeting & valuation
// ---------------------------------------------------------------------------------------------------------------

/** npv: positive adds value at the rate, negative destroys it, zero (as printed) breaks even. */
export function npvReading(ratePct: number, flows: number[]): string | undefined {
  const rate = ratePct / 100;
  const v = npv(rate, flows);
  if (!flows.length || !finite(rate, v)) return undefined;
  const vs = finMoney(v);
  const head = `Discounted at ${inPct(ratePct)} a period, the cash flows are worth ${vs} in today's money (the NPV)`;
  if (isZeroText(vs)) return `${head}: the project just breaks even at that rate.`;
  return isNegText(vs) ? `${head}: negative, so at that rate the project loses value.` : `${head}: positive, so at that rate the project adds value.`;
}

/** Sign changes in a cash-flow list (zeros skipped), and the sign of the first non-zero flow. */
function signPattern(flows: number[]): { changes: number; first: number } {
  let prev = 0;
  let changes = 0;
  let first = 0;
  for (const c of flows) {
    const s = Math.sign(c);
    if (!s) continue;
    if (!first) first = s;
    if (prev && s !== prev) changes++;
    prev = s;
  }
  return { changes, first };
}

/** The IRR and XIRR sentence, hedged by the sign pattern of the flows. */
function rateOfReturnReading(rateText: string, per: string, flows: number[]): string {
  const { changes, first } = signPattern(flows);
  if (changes > 1) {
    return `A rate of ${rateText} ${per} makes the NPV zero, but these cash flows change sign more than once, so other rates may too; judge them by NPV instead.`;
  }
  if (first < 0) {
    return `The cash flows earn ${rateText} ${per}: at any discount rate below that the NPV is positive, so the project pays if your cost of capital is lower.`;
  }
  return `Money in first and out later costs ${rateText} ${per}, like a loan at that rate: worth taking only if other funding costs more.`;
}

/**
 * irr. The pane passes the rate it already solved (fix-fin R1 #2: solving again doubled a search that could take
 * seconds); without it the rate is solved here.
 */
export function irrReading(flows: number[], solved?: number | null): string | undefined {
  const v = solved === undefined ? irr(flows) : solved;
  if (v === null || !finite(v)) return undefined;
  return rateOfReturnReading(finPct(v), "per period", flows);
}

/** xirr (the pane has checked one date per flow, and passes the rate it solved). */
export function xirrReading(flows: number[], days: number[], solved?: number | null): string | undefined {
  if (flows.length !== days.length) return undefined;
  const v = solved === undefined ? xirr(flows, days) : solved;
  if (v === null || !finite(v)) return undefined;
  // The sign pattern in date order (readXirrDates refuses a date before the first, not later dates out of order).
  const ordered = flows.map((c, k) => ({ c, d: days[k] })).sort((a, b) => a.d - b.d).map((x) => x.c);
  return rateOfReturnReading(finPct(v), "a year", ordered);
}

/** dcf: the value, and how much of it is the terminal value (the text's share, to 0.1%). */
export function dcfReading(ratePct: number, flows: number[], gPct: number): string | undefined {
  const rate = ratePct / 100;
  const gT = gPct / 100;
  const v = dcf(rate, flows, gT);
  const n = flows.length;
  if (!n || !finite(v)) return undefined;
  const tv = (flows[n - 1] * (1 + gT)) / (rate - gT);
  const pvTv = tv / Math.pow(1 + rate, n);
  const share = v !== 0 ? (pvTv / v) * 100 : NaN;
  const head = `The cash flows are valued at about ${finMoney(v)}`;
  // The growth rate as typed (R3 MINOR 5: 9.999% printed as "10.00%", the same as the discount rate).
  const gs = inPct(gPct);
  if (!Number.isFinite(share) || share < 0 || isNegText(finMoney(v))) return `${head}, a scenario resting on ${gs} growth forever after period ${n}.`;
  const shareText = `${finFixed(share, 1)}%`;
  // Branch on the printed share: 50.0% is half, not "mostly".
  if (shareText === "50.0%") return `${head}; the terminal value is ${shareText} of it, so the forecast and the growth assumed after period ${n} weigh about equally.`;
  if (share > 50) {
    return `${head}, and ${shareText} of that is the terminal value, so the result rests mostly on the ${gs} growth assumed forever after period ${n}.`;
  }
  return `${head}; the terminal value is ${shareText} of it, so the ${n}-period forecast carries most of the value.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Derivatives
// ---------------------------------------------------------------------------------------------------------------

/** bs: the price as the value of the right to buy or sell at the strike. Inputs already checked by the pane. */
export function bsReading(type: OptionType, S: number, K: number, t: number, ratePct: number, sigPct: number, qPct: number): string | undefined {
  const price = blackScholes(type, S, K, t, ratePct / 100, sigPct / 100, qPct / 100);
  if (!finite(price)) return undefined;
  const ps = finMoney(price);
  const right = type === "put" ? "sell" : "buy";
  if (t === 0) return `At expiry this ${type} is worth ${ps}, its value if exercised now against the ${finMoney(K)} strike.`;
  if (isZeroText(ps)) {
    return `Under the model this ${type} is worth ${ps} to the cent: with these inputs it is not expected to finish in the money.`;
  }
  return (
    `Under the model this ${type} is worth ${ps}: the fair price today of the right to ${right} at ${finMoney(K)} on expiry, ` +
    `${inNum(t)} ${plural(t, "year")} away, with ${inPct(sigPct)} annual volatility.`
  );
}

/** greeks: delta and theta in words. */
export function greeksReading(type: OptionType, S: number, K: number, t: number, ratePct: number, sigPct: number, qPct: number): string | undefined {
  const g = blackScholesGreeks(type, S, K, t, ratePct / 100, sigPct / 100, qPct / 100);
  if (!finite(g.delta, g.theta)) return undefined;
  const d = finFixed(g.delta, 4);
  const th = finFixed(g.theta / 365, 4);
  const thetaClause = isZeroText(th)
    ? "and the passing of a day barely changes its value."
    : isNegText(th)
      ? `and its theta of ${th} is what it loses each day as expiry nears, all else equal.`
      : `and its theta of ${th} is what it gains each day as expiry nears, all else equal.`;
  return `With a delta of ${d}, the ${type}'s value changes by about ${d} for each unit rise in the underlying's price, ${thetaClause}`;
}

/** iv: the volatility the price implies. */
export function ivReading(type: OptionType, price: number, S: number, K: number, t: number, ratePct: number, qPct: number, solved?: number | null): string | undefined {
  const v = solved === undefined ? impliedVolatility(type, price, S, K, t, ratePct / 100, qPct / 100) : solved;
  if (v === null || !finite(v)) return undefined;
  // The price as typed (R1 #5).
  return `A ${type} price of ${inNum(price)} implies a volatility of ${finPct(v)} a year: the size of price swings the model needs to justify that price.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Fixed income
// ---------------------------------------------------------------------------------------------------------------

/** Discount, par or premium, by the printed price against the printed face. */
function parity(priceText: string, faceText: string, price: number, face: number): "par" | "discount" | "premium" {
  if (priceText === faceText) return "par";
  return price < face ? "discount" : "premium";
}

/** bond. */
export function bondReading(face: number, couponPct: number, ytmPct: number, years: number, freq: number): string | undefined {
  const price = bondPrice(face, couponPct / 100, ytmPct / 100, years, freq);
  // A zero or negative face has no par to compare against.
  if (!finite(price, face) || !(face > 0)) return undefined;
  const ps = finMoney(price);
  const fs = finMoney(face);
  // Coupon and yield as typed (R1 #5).
  const cs = inPct(couponPct);
  const ys = inPct(ytmPct);
  const kind = parity(ps, fs, price, face);
  if (kind === "par") {
    return couponPct === ytmPct
      ? `At ${aAn(ys)} ${ys} yield the bond is worth ${ps}, its face value (par), because its ${cs} coupon matches the yield.`
      : `At ${aAn(ys)} ${ys} yield the bond is worth ${ps}, its face value (par) to the cent, because its ${cs} coupon is that close to the yield.`;
  }
  const why = kind === "discount" ? `its ${cs} coupon pays less than the ${ys} market yield` : `its ${cs} coupon pays more than the ${ys} market yield`;
  return `At ${aAn(ys)} ${ys} yield the bond is worth ${ps} against ${fs} face: a ${kind}, because ${why}.`;
}

/** ytm. */
export function ytmReading(price: number, face: number, couponPct: number, years: number, freq: number, solved?: number | null): string | undefined {
  // The pane passes the yield it solved (R1 #2).
  const y = solved === undefined ? bondYTM(price, face, couponPct / 100, years, freq) : solved;
  if (y === null || !finite(y, price, face) || !(face > 0)) return undefined;
  const ps = finMoney(price);
  const fs = finMoney(face);
  const cs = inPct(couponPct);
  const first = `Bought at ${ps} and held to maturity, the bond earns ${finPct(y)} a year, provided every coupon is reinvested at that rate.`;
  const kind = parity(ps, fs, price, face);
  const second =
    kind === "par"
      ? `At face value the yield matches the ${cs} coupon.`
      : kind === "discount"
        ? `The price is below the ${fs} face, so the yield is above the ${cs} coupon.`
        : `The price is above the ${fs} face, so the yield is below the ${cs} coupon.`;
  return fit(first, second);
}

/** bondrisk: modified duration as the price change per point of yield; convexity as the cushion. */
export function bondriskReading(face: number, couponPct: number, ytmPct: number, years: number, freq: number): string | undefined {
  const a = bondAnalytics(face, couponPct / 100, ytmPct / 100, years, freq);
  if (!finite(a.price, a.modified, a.convexity) || !(a.price > 0)) return undefined;
  const md = finFixed(a.modified, 3);
  return (
    `If yields rose by one percentage point, the price of ${finMoney(a.price)} would fall by about ${md}% (the modified duration of ${md} years); ` +
    `convexity of ${finFixed(a.convexity, 2)} makes the true change a little better than that, up or down.`
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------------------------------------------

/** depr: declining balance, front-loaded. The pane refuses a bad life, factor or salvage first. */
export function deprReading(cost: number, salvage: number, life: number, factor: number): string | undefined {
  const rows = decliningBalanceSchedule(cost, salvage, life, factor);
  if (!rows.length || !rows.every((x) => finite(x.depreciation, x.bookValue))) return undefined;
  const last = rows[rows.length - 1];
  const name = factor === 2 ? "Double declining balance" : `Declining balance at a factor of ${inNum(factor)}`;
  const largest = rows.length > 1 && rows.every((x) => x.depreciation <= rows[0].depreciation);
  const head = `${name} writes off ${finMoney(rows[0].depreciation)} in year ${rows[0].year}${largest ? ", the largest charge," : ""}`;
  const book = finMoney(last.bookValue);
  // The FIRST year whose printed book value is the salvage (R3 MINOR 6: "by year 5" when it was reached in year 2).
  const reached = rows.find((x) => finMoney(x.bookValue) === finMoney(salvage));
  return reached
    ? `${head} and reaches the ${book} salvage value in year ${reached.year}${reached.year < last.year ? ", with nothing more to write off after that" : ""}.`
    : `${head} and leaves a book value of ${book} after year ${last.year}, above the ${finMoney(salvage)} salvage value.`;
}

/** depr-sl. The pane refuses a bad life and a salvage above cost first. */
export function deprSlReading(cost: number, salvage: number, life: number): string | undefined {
  const annual = straightLineDepreciation(cost, salvage, life);
  if (!finite(annual, cost, salvage) || !(life > 0)) return undefined;
  const as = finMoney(annual);
  // R3 B2: "salvage equal to cost" only when it is; a charge that rounds to 0.00 is a small charge, not none.
  if (salvage === cost) return `The asset keeps its ${finMoney(cost)} book value: with salvage equal to cost there is nothing to depreciate.`;
  if (isZeroText(as)) {
    return `The asset loses less than a cent of book value each year (${as} to the cent), from ${finMoney(cost)} down to its ${finMoney(salvage)} salvage value.`;
  }
  const lifeText = life > 60 ? `a useful life of ${finFixed(life, 2)} years` : `${inNum(life)} ${plural(life, "year")}`;
  return `The asset loses ${as} of book value each year, from ${finMoney(cost)} down to its ${finMoney(salvage)} salvage value over ${lifeText}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Portfolio & risk
// ---------------------------------------------------------------------------------------------------------------

/** returns: annualised return, volatility, and the Sharpe ratio when it is defined. `rets` are decimals, as the pane holds them. */
export function returnsReading(rets: number[], ppy: number, rfPct: number): string | undefined {
  const ar = annualizedReturn(rets, ppy);
  const av = annualizedVolatility(rets, ppy);
  if (!finite(ar)) return undefined;
  const head = !Number.isFinite(av)
    ? `These returns compound to ${finPct(ar)} a year`
    : isZeroText(finPct(av))
      ? `These returns compound to ${finPct(ar)} a year, with no swings at all (volatility ${finPct(av)})`
      : `These returns compound to ${finPct(ar)} a year, with swings of about ${finPct(av)} a year (the volatility)`;
  const sh = sharpeRatio(rets, rfPct / 100, ppy);
  if (!Number.isFinite(sh) || !Number.isFinite(av)) return `${head}.`;
  const ss = finFixed(sh, 3);
  if (isZeroText(ss)) return `${head}; the Sharpe ratio of ${ss} means they earned no more than the risk-free rate.`;
  return isNegText(ss)
    ? `${head}; the Sharpe ratio of ${ss} means they fell short of the risk-free rate.`
    : `${head}; the Sharpe ratio of ${ss} is the average return above the risk-free rate per unit of that volatility.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Currency (the result of lib/econE5aCalcs.ts finCurrencyCalc, read from its own table cells)
// ---------------------------------------------------------------------------------------------------------------

type CellTable = { label: string; rows: string[][] };

/** A money cell as a number ("€ 1,250.00 (EUR)", "−KWD 420.125"): the code in brackets, symbols, grouping dropped. */
export function cellAmount(cell: string): number {
  const s = cell.replace(/\([^)]*\)/g, "").replace(/−/g, "-");
  const m = /-?\s*[^\d-]*?(\d[\d,]*(?:\.\d+)?)/.exec(s);
  if (!m) return NaN;
  const v = Number(m[1].replace(/,/g, ""));
  return s.trim().startsWith("-") ? -v : v;
}

/** The conversions table of a currency result, as [amount, cross rate, converted] rows (header dropped). */
export function currencyConversions(out: { tables?: CellTable[] }): { target: string; rows: string[][] } | null {
  const t = (out.tables ?? []).find((x) => x.label.startsWith("Conversions to "));
  if (!t || t.rows.length < 2) return null;
  return { target: t.label.slice("Conversions to ".length), rows: t.rows.slice(1) };
}

/**
 * The "as of" date the rates table prints (R2 MINOR: the reading left it out), only when it reads as a real date: the
 * field is free text, and free text is never echoed. Printed exactly as the table label prints it.
 */
function currencyAsOf(out: { tables?: CellTable[] }): string | undefined {
  const label = (out.tables ?? []).map((t) => t.label).find((l) => l.startsWith("Rates as read (as of "));
  const m = label ? /^Rates as read \(as of (.{1,40})\)$/.exec(label) : null;
  if (!m) return undefined;
  return typeof parseDateField(m[1], "as-of date") === "number" ? m[1] : undefined;
}

export function finCurrencyReading(out: { text: string; ok?: boolean; tables?: CellTable[] }): string | undefined {
  if (out.ok === false) return undefined;
  const conv = currencyConversions(out);
  const asOf = currencyAsOf(out);
  const when = (s: string): string => (asOf ? `${s} (as of ${asOf})` : s);
  if (!conv) return "No amounts were typed, so the tables show only the cross rates implied by the rates you typed.";
  if (conv.rows.length === 1) {
    const [a, cr, c] = conv.rows[0];
    return `At the rate you typed, ${a} is ${c} (${cr}); the result is only as current as ${when("that rate")}.`;
  }
  let best = conv.rows[0];
  for (const r of conv.rows) if (Math.abs(cellAmount(r[2])) > Math.abs(cellAmount(best[2]))) best = r;
  return `At the rates you typed, the largest conversion is ${best[0]} to ${best[2]}; each amount uses the exact cross rate and is rounded once, and is only as current as ${when("those rates")}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Litigation damages
// ---------------------------------------------------------------------------------------------------------------

/** The cells of a table's "Total" row, or null. */
function totalRow(t: CellTable | undefined): string[] | null {
  const row = t?.rows.find((r) => r[0] === "Total");
  return row ?? null;
}

/** dmg-prejudgment, from the report's Total row and the end date typed (printed by the text's own longDate). */
export function prejudgmentReading(out: { ok: boolean; table?: CellTable }, endField: string, method: string): string | undefined {
  if (!out.ok) return undefined;
  const tot = totalRow(out.table);
  const end = parseDateField(endField, "end date");
  const how = METHOD_WORDS[method as InterestMethod];
  if (!tot || typeof end !== "number" || !how) return undefined;
  const [, , , amount, interest, total] = tot;
  if (isZeroText(interest)) return `No interest accrues on the ${amount} of damages up to ${longDate(end)}, so the total stays ${total}, computed from the inputs given.`;
  return `Interest of ${interest} (${how}, at the rates entered, up to ${longDate(end)}) brings the ${amount} of damages to ${total}, computed from the inputs given.`;
}

/** dmg-postjudgment, from the report's Total row. */
export function postjudgmentReading(out: { ok: boolean; table?: CellTable }, paymentField: string, ratePctIn: number): string | undefined {
  if (!out.ok) return undefined;
  const tot = totalRow(out.table);
  const pay = parseDateField(paymentField, "payment date");
  if (!tot || typeof pay !== "number" || !Number.isFinite(ratePctIn)) return undefined;
  const [, , , amount, interest, total] = tot;
  // R2 MINOR: no "$0.00 of interest at 0% a year"; say why nothing accrued.
  if (isZeroText(interest)) {
    return ratePctIn === 0
      ? `Paid on ${longDate(pay)}, the ${amount} judgment comes to ${total}: at a 0% rate no interest accrues.`
      : `Paid on ${longDate(pay)}, the ${amount} judgment comes to ${total}: no interest accrues to the cent by that date.`;
  }
  return (
    `Paid on ${longDate(pay)}, the ${amount} judgment comes to ${total}, including ${interest} of interest at ` +
    `${ratePct(ratePctIn / 100)} a year compounded annually from the judgment date.`
  );
}

/** dmg-lost-earnings, from the report's Total row; the horizon as the text prints it. */
export function lostEarningsReading(
  out: { ok: boolean; table?: CellTable },
  f: { horizonMode: string; horizon: number; startAge: number; discountPct: number },
): string | undefined {
  if (!out.ok) return undefined;
  const tot = totalRow(out.table);
  if (!tot) return undefined;
  const [, , , net, , pv] = tot;
  const years = f.horizonMode === "age" ? f.horizon - f.startAge : f.horizon;
  const num = (x: number): string => (Number.isInteger(x) ? String(x) : finFixed(x, 2));
  // lib/lostEarnings.ts pct(), on the same decimal it prints.
  const pct = `${finFixed((f.discountPct / 100) * 100, 2).replace(/\.?0+$/, "")}%`;
  return (
    `Over ${num(years)} ${years === 1 ? "year" : "years"} from age ${num(f.startAge)}, the lost earnings have a present value of ${pv} at the start of year 1, discounted at ${pct} a year, ` +
    `against ${net} of net loss before discounting, computed from the inputs given.`
  );
}

/** dmg-royalty, from the engine's own computation (computeRoyalty) and its formatters. */
export function royaltyReading(inp: RoyaltyInput): string | undefined {
  const c = computeRoyalty(inp);
  if ("error" in c) return undefined;
  const rateText = inp.basis === "unit" ? `${usd(dmgNum(inp.rate))} per unit` : `${dmgPct(inp.rate)} of revenue`;
  const n = c.periods.length;
  const first =
    `A running royalty of ${rateText}, ${inp.apportionPct === 100 ? `with no apportionment (${dmgPct(100)})` : `apportioned at ${dmgPct(inp.apportionPct)} to the patented feature`}, comes to ${dmgMoney(c.total)} ` +
    `over ${n.toLocaleString("en-US")} ${plural(n, "period")}, computed from the inputs given.`;
  if (c.pvTotal === null) return first;
  const diff = roundCents(inp.lumpSum - c.pvTotal);
  const pv = dmgMoney(c.pvTotal);
  const second =
    diff === 0
      ? `The ${dmgMoney(inp.lumpSum)} lump sum entered equals the running royalty's present value of ${pv} at ${dmgPct(inp.discountPct)} a year.`
      : `The ${dmgMoney(inp.lumpSum)} lump sum entered is ${dmgMoney(Math.abs(diff))} ${diff > 0 ? "above" : "below"} the running royalty's present value of ${pv} at ${dmgPct(inp.discountPct)} a year.`;
  return fit(first, second);
}

/** dmg-lost-profits, from the engine's own computation (computeLostProfits) and its formatters. */
export function lostProfitsReading(inp: LostProfitsInput): string | undefined {
  const c = computeLostProfits(inp);
  if ("error" in c) return undefined;
  const t = c.totals;
  const parts = [`lost profits of ${dmgMoney(t.lostProfits)} on ${dmgQty(t.captured)} captured units at a ${dmgUnitMoney(c.unitMargin)} margin`];
  if (inp.erosion) parts.push(`price erosion of ${dmgMoney(t.erosion)}`);
  if (inp.remainder !== "none") parts.push(`${dmgMoney(t.remainder)} of royalty on the uncaptured units`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const first = `Computed from the inputs given, the total is ${dmgMoney(t.total)}: ${list}.`;
  const second = c.capped ? `Spare capacity limited the captured units in ${c.capped} of ${c.periods.length} periods.` : undefined;
  return fit(first, second);
}

/** dmg-summary, from the result's own table cells (the summary has no exported computation). */
export function damagesSummaryReading(out: { text: string; ok?: boolean; tables?: CellTable[] }, multiplier: number): string | undefined {
  if (out.ok === false || !out.tables || out.tables.length < 2) return undefined;
  const [dmgT, totT] = out.tables;
  const tot = totalRow(dmgT);
  if (!tot) return undefined;
  const [, lp, pe, rr, dmg] = tot;
  // Header, the periods, Total, and (with a multiplier) its two rows.
  const n = dmgT.rows.length - 2 - (multiplier !== 1 ? 2 : 0);
  const first = `Computed from the inputs given, damages total ${dmg} over ${n.toLocaleString("en-US")} ${plural(n, "period")}: lost profits ${lp}, price erosion ${pe} and reasonable royalty ${rr}.`;
  const head2 = totT.rows[0];
  const iInt = head2.indexOf("Interest");
  const iTot = head2.indexOf("Total");
  const tot2 = totalRow(totT);
  const last = totT.rows[totT.rows.length - 1];
  const grand = (multiplier !== 1 ? last : tot2)?.[iTot];
  const parts: string[] = [];
  if (multiplier !== 1) {
    const enh = dmgT.rows.find((r) => r[0] === `Damages × ${dmgNum(multiplier)}`)?.[4];
    if (!enh) return first;
    parts.push(`with the × ${dmgNum(multiplier)} multiplier entered they are ${enh}`);
  }
  if (iInt >= 0 && tot2) parts.push(`with ${tot2[iInt]} of interest the total is ${grand}`);
  if (!parts.length) return first;
  const s = parts.join(", and ");
  return fit(first, `${s.charAt(0).toUpperCase()}${s.slice(1)}.`);
}

/** dmg-gp-worksheet: a blank worksheet; the count is the worksheet's own. */
export function georgiaPacificReading(): string {
  return `This is a blank worksheet of the ${GEORGIA_PACIFIC_FACTORS.length} Georgia-Pacific factors: for each, record the evidence and whether it pushes a reasonable royalty rate up, down or neither.`;
}

/** dmg-panduit-worksheet: a blank worksheet; hedged, Panduit is one way to prove but-for causation. */
export function panduitReading(): string {
  return `This is a blank worksheet of the ${PANDUIT_FACTORS.length} Panduit factors, one recognized way to show the patentee would have made the infringer's sales: record the evidence for each and whether it is shown.`;
}
