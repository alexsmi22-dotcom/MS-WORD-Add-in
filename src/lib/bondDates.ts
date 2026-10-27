/**
 * Fixed income on real dates (release F1, gap item #3): coupon schedules from settlement and maturity, the five Excel
 * day-count bases, accrued interest, clean and dirty prices from a yield, yield from a clean price, Macaulay and
 * modified duration and convexity, yield to call and yield to worst, and Treasury bill yields. Pure: no DOM, no Office.
 *
 * THE PRICING MODEL IS EXCEL'S PRICE/YIELD (Microsoft's PRICE, YIELD, ACCRINT, DURATION documentation), for every
 * basis, so a result can be checked against a spreadsheet:
 *   coupon c = 100 × rate / f every period (not rate × the period's day-count fraction);
 *   A   = days from the previous coupon to settlement, counted by the basis;
 *   E   = days in the coupon period: actual days for ACT/ACT, 365/f for ACT/365 Fixed, 360/f otherwise;
 *   DSC = days from settlement to the next coupon: E − A for the two 30/360 bases (as Excel does), actual days for
 *         the three actual bases;
 *   dirty = Σₖ c / (1 + y/f)^(k − 1 + DSC/E) + R / (1 + y/f)^(N − 1 + DSC/E)  when N > 1;
 *   dirty = (c + R) / (1 + (DSC/E) × y/f)                                    when N = 1 (Excel's simple interest in
 *         the final period, as PRICE's and YIELD's one-period formulas do);
 *   accrued = c × A / E;  clean = dirty − accrued.
 * QuantLib agrees with this model exactly for ACT/ACT ICMA (scripts/bonds-oracle.py). For ACT/360 and ACT/365 Fixed a
 * QuantLib FixedRateBond pays coupons of rate × actual/360 (or /365) rather than rate/f, so those bases are checked
 * against an independent transcription of Microsoft's formulas instead.
 *
 * 30/360 US IS EXCEL'S BASIS 0, NOT SIA. Excel's basis 0 (and LibreOffice's Excel-compatible ScaDate) applies, in
 * order and stopping at the first that matches: D1 = 31 and D2 = 31 → both 30; D1 = 31 → D1 = 30; D1 = 30 and
 * D2 = 31 → D2 = 30; both dates the last day of February → both 30; D1 the last day of February → D1 = 30. So from
 * the last day of February to the 31st of a month counts D2 as 31, where SIA's 30/360 US (QuantLib Thirty360.USA)
 * counts 30. Both are named in the oracle fixture.
 */
import { civilDay, civilFromDay, daysInMonth, isLeapYear, addMonthsClamped, longDate } from "./damagesInterest";

export type BondBasis = "30360us" | "30e360" | "actact" | "act360" | "act365";

export const BOND_BASES: BondBasis[] = ["30360us", "actact", "act360", "act365", "30e360"];

/** The exact name printed for each basis. */
export const BASIS_NAMES: Record<BondBasis, string> = {
  "30360us": "30/360 US (NASD), Excel basis 0",
  actact: "ACT/ACT ICMA (coupon-period based), Excel basis 1",
  act360: "ACT/360, Excel basis 2",
  act365: "ACT/365 Fixed, Excel basis 3",
  "30e360": "30E/360 (Eurobond), Excel basis 4",
};

/** How A, E and DSC are counted under each basis (printed on the Conventions line). */
export const BASIS_RULES: Record<BondBasis, string> = {
  "30360us": "A by 30/360 US (NASD), E = 360/f, DSC = E − A",
  actact: "A, E and DSC in actual days within the coupon period",
  act360: "A and DSC in actual days, E = 360/f",
  act365: "A and DSC in actual days, E = 365/f",
  "30e360": "A by 30E/360, E = 360/f, DSC = E − A",
};

export const BOND_FREQS = [1, 2, 4, 12];
/** A 100-year monthly bond: past any instrument that exists. */
export const MAX_BOND_COUPONS = 1200;

export type Refusal = { error: string };
const refuse = (error: string): Refusal => ({ error });

// ------------------------------------------------------------------------------------------------------------------
// Day counts
// ------------------------------------------------------------------------------------------------------------------

function isLastOfFeb(y: number, m: number, d: number): boolean {
  return m === 2 && d === daysInMonth(y, 2);
}

/** 30/360 US (NASD) days from d1 to d2 as Excel's basis 0 counts them (rule chain in the header). d1 ≤ d2. */
export function days360US(day1: number, day2: number): number {
  const a = civilFromDay(day1);
  const b = civilFromDay(day2);
  let d1 = a.d;
  let d2 = b.d;
  if (d1 === 31 && d2 === 31) {
    d1 = 30;
    d2 = 30;
  } else if (d1 === 31) d1 = 30;
  else if (d1 === 30 && d2 === 31) d2 = 30;
  else if (isLastOfFeb(a.y, a.m, a.d) && isLastOfFeb(b.y, b.m, b.d)) {
    d1 = 30;
    d2 = 30;
  } else if (isLastOfFeb(a.y, a.m, a.d)) d1 = 30;
  return 360 * (b.y - a.y) + 30 * (b.m - a.m) + (d2 - d1);
}

/** 30E/360 (Eurobond, Excel basis 4): a 31st counts as the 30th, at either end; no February rule. */
export function days360E(day1: number, day2: number): number {
  const a = civilFromDay(day1);
  const b = civilFromDay(day2);
  const d1 = Math.min(a.d, 30);
  const d2 = Math.min(b.d, 30);
  return 360 * (b.y - a.y) + 30 * (b.m - a.m) + (d2 - d1);
}

/** Days from d1 to d2 by the basis (30/360 counts for the two 30/360 bases, actual days otherwise). */
export function basisDays(basis: BondBasis, d1: number, d2: number): number {
  if (basis === "30360us") return days360US(d1, d2);
  if (basis === "30e360") return days360E(d1, d2);
  return d2 - d1;
}

// ------------------------------------------------------------------------------------------------------------------
// Coupon schedule
// ------------------------------------------------------------------------------------------------------------------

export interface CouponSchedule {
  /** Coupon dates after settlement, ascending; the last is the maturity (or call) date. */
  dates: number[];
  /** The previous (quasi-)coupon date: on or before settlement. */
  prev: number;
  next: number;
  /** End-of-month rule in force: the maturity is the last day of its month. */
  eom: boolean;
}

function lastDayOfMonthOf(day: number): number {
  const { y, m } = civilFromDay(day);
  return civilDay(y, m, daysInMonth(y, m));
}

/** The k-th coupon date before maturity: k × 12/f months back from the ORIGINAL maturity date (never stepped). */
function couponBefore(maturity: number, k: number, freq: number, eom: boolean): number {
  const d = addMonthsClamped(maturity, -k * (12 / freq));
  return eom ? lastDayOfMonthOf(d) : d;
}

/**
 * The regular schedule dated backward from maturity. If the maturity is the last day of its month every coupon falls
 * on the last day of its month (the end-of-month rule, as Excel's COUPPCD/COUPNCD and QuantLib's endOfMonth do);
 * otherwise each date is the maturity's day of month, clamped to shorter months. No issue date is taken, so the
 * first period is a regular quasi-coupon period and there is no odd first or last coupon.
 */
export function couponSchedule(settle: number, maturity: number, freq: number): CouponSchedule | Refusal {
  if (!BOND_FREQS.includes(freq)) return refuse(`Coupons per year must be 1, 2, 4 or 12 (got ${freq}).`);
  if (!(maturity > settle)) return refuse("Maturity date must be after the settlement date.");
  const { y, m, d } = civilFromDay(maturity);
  const eom = d === daysInMonth(y, m);
  const dates: number[] = [];
  let k = 0;
  for (;;) {
    const c = couponBefore(maturity, k, freq, eom);
    if (c <= settle) {
      dates.reverse();
      return { dates, prev: c, next: dates[0], eom };
    }
    dates.push(c);
    k++;
    if (k > MAX_BOND_COUPONS) {
      return refuse(
        `Settlement to maturity spans more than ${MAX_BOND_COUPONS.toLocaleString("en-US")} coupon periods; this prices at most ${MAX_BOND_COUPONS.toLocaleString("en-US")} (a 100-year monthly bond). Check the dates and the frequency.`,
      );
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Pricing
// ------------------------------------------------------------------------------------------------------------------

export interface BondSpec {
  settle: number;
  maturity: number;
  /** Annual coupon rate, decimal (0.05). */
  rate: number;
  /** Redemption per 100 of face (100 at par; a call price for yield to call). */
  redemption: number;
  freq: number;
  basis: BondBasis;
  /** Optional: redeem at this coupon date instead of maturity (a call), schedule kept from the maturity. */
  redeemOn?: number;
}

export interface BondPeriod {
  schedule: CouponSchedule;
  /** Coupons from settlement to redemption. */
  N: number;
  A: number;
  E: number;
  DSC: number;
  /** Coupon per 100 of face. */
  c: number;
}

/** The coupon period quantities A, E, DSC and N for a bond (Excel's definitions; see the header). */
export function bondPeriod(spec: BondSpec): BondPeriod | Refusal {
  const s = couponSchedule(spec.settle, spec.maturity, spec.freq);
  if ("error" in s) return s;
  let schedule = s;
  if (spec.redeemOn !== undefined) {
    const i = s.dates.indexOf(spec.redeemOn);
    if (!(spec.redeemOn > spec.settle)) return refuse("Call date must be after the settlement date.");
    if (spec.redeemOn > spec.maturity) return refuse("Call date must be on or before the maturity date.");
    if (i < 0) {
      return refuse(
        `Call date ${longDate(spec.redeemOn)} is not one of the bond's coupon dates (they fall on the ${ordinalDays(s)} dated back from maturity). A call between coupon dates is an odd last period, which this does not model.`,
      );
    }
    schedule = { ...s, dates: s.dates.slice(0, i + 1) };
  }
  const f = spec.freq;
  const A = basisDays(spec.basis, schedule.prev, spec.settle);
  const E = spec.basis === "actact" ? schedule.next - schedule.prev : spec.basis === "act365" ? 365 / f : 360 / f;
  const DSC = spec.basis === "30360us" || spec.basis === "30e360" ? E - A : schedule.next - spec.settle;
  return { schedule, N: schedule.dates.length, A, E, DSC, c: (100 * spec.rate) / f };
}

function ordinalDays(s: CouponSchedule): string {
  const ds = [...new Set([s.prev, ...s.dates.slice(0, 12)].map((d) => civilFromDay(d)).map((x) => `${MONTH_SHORT[x.m - 1]} ${x.d}`))];
  return s.eom ? "last day of the month" : ds.slice(0, 4).join(", ");
}
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Exponent (in coupon periods) of the k-th flow, k = 1..N. */
function periodsTo(p: BondPeriod, k: number): number {
  return k - 1 + p.DSC / p.E;
}

/** Dirty (full) price per 100 at yield y (annual decimal, compounded f times a year). */
export function dirtyPriceAt(p: BondPeriod, spec: BondSpec, y: number): number {
  const f = spec.freq;
  if (p.N === 1) return (p.c + spec.redemption) / (1 + (p.DSC / p.E) * (y / f));
  const v = 1 + y / f;
  let sum = 0;
  for (let k = 1; k <= p.N; k++) sum += p.c / Math.pow(v, periodsTo(p, k));
  return sum + spec.redemption / Math.pow(v, periodsTo(p, p.N));
}

export interface BondFlow {
  date: number;
  /** Actual days from settlement. */
  days: number;
  /** Discount time in years: (k − 1 + DSC/E) / f. */
  t: number;
  /** Cash flow per 100 of face (coupon, plus redemption on the last). */
  cf: number;
  df: number;
  pv: number;
}

export interface BondResult {
  period: BondPeriod;
  yield: number;
  dirty: number;
  clean: number;
  accrued: number;
  macaulay: number;
  modified: number;
  convexity: number;
  flows: BondFlow[];
}

/** Everything at yield y: prices, accrued, durations (on the dirty price) and the cash-flow schedule. */
export function bondAtYield(spec: BondSpec, y: number): BondResult | Refusal {
  const why = specRefusal(spec);
  if (why) return refuse(why);
  if (!Number.isFinite(y)) return refuse("Yield must be a finite number.");
  const p = bondPeriod(spec);
  if ("error" in p) return p;
  const f = spec.freq;
  if (!(1 + y / f > 0)) return refuse(`A yield of ${pctText(y)} compounded ${f} time${f === 1 ? "" : "s"} a year is at or below −100% per period; enter a yield above ${pctText(-f)}.`);
  if (p.N === 1 && !(1 + (p.DSC / p.E) * (y / f) > 0)) return refuse("That yield discounts the final payment to a negative value; enter a higher yield.");
  const flows: BondFlow[] = [];
  let dirty = 0;
  let wt = 0;
  let conv = 0;
  const v = 1 + y / f;
  for (let k = 1; k <= p.N; k++) {
    const n = periodsTo(p, k);
    const cf = p.c + (k === p.N ? spec.redemption : 0);
    const df = p.N === 1 ? 1 / (1 + (p.DSC / p.E) * (y / f)) : Math.pow(v, -n);
    const pv = cf * df;
    dirty += pv;
    const t = n / f;
    wt += t * pv;
    // Convexity (1/P) d²P/dy²: compounded, n(n+1)/f² / (1 + y/f)²; simple single flow, 2t²/(1 + y t)².
    conv += p.N === 1 ? (pv * 2 * t * t) / Math.pow(1 + y * t, 2) : (pv * n * (n + 1)) / (f * f * v * v);
    flows.push({ date: p.schedule.dates[k - 1], days: p.schedule.dates[k - 1] - spec.settle, t, cf, df, pv });
  }
  const accrued = (p.c * p.A) / p.E;
  const macaulay = wt / dirty;
  const modified = p.N === 1 ? macaulay / (1 + y * macaulay) : macaulay / v;
  const r: BondResult = { period: p, yield: y, dirty, clean: dirty - accrued, accrued, macaulay, modified, convexity: conv / dirty, flows };
  if (![dirty, accrued, macaulay, modified, r.convexity].every(Number.isFinite)) return refuse("The price is not a finite number at that yield; check the yield and the dates.");
  return r;
}

/** Yield search range for N > 1: just above −100% per period up to 10,000% a year. */
const Y_HI = 100;

/** Yield from a clean price per 100 (bisection to machine precision, at most 400 halvings; N = 1 in closed form). */
export function yieldFromClean(spec: BondSpec, clean: number): { yield: number } | Refusal {
  const why = specRefusal(spec);
  if (why) return refuse(why);
  if (!Number.isFinite(clean) || clean <= 0) return refuse("Clean price must be a positive number (per 100 of face).");
  const p = bondPeriod(spec);
  if ("error" in p) return p;
  const f = spec.freq;
  const accrued = (p.c * p.A) / p.E;
  const dirty = clean + accrued;
  if (p.N === 1) {
    // Excel's YIELD for one coupon period or less: simple interest over DSC/E of a period.
    if (!(p.DSC > 0)) return refuse("Settlement falls at the end of the last coupon period by this day count, so the price does not depend on the yield.");
    const y = ((p.c + spec.redemption) / dirty - 1) * f * (p.E / p.DSC);
    if (!Number.isFinite(y)) return refuse("No finite yield matches that price.");
    return { yield: y };
  }
  const lo0 = -0.99 * f;
  const P = (y: number): number => dirtyPriceAt(p, spec, y) - dirty;
  const pLo = P(lo0);
  const pHi = P(Y_HI);
  if (!(pLo >= 0 && pHi <= 0)) {
    return refuse(
      `No yield between ${pctText(lo0)} and ${pctText(Y_HI)} gives a clean price of ${clean} (the price at those yields runs from ${Number.isFinite(pLo + dirty - accrued) ? fmtPlain(pLo + dirty - accrued) : "an unbounded value"} down to ${fmtPlain(pHi + dirty - accrued)}).`,
    );
  }
  let lo = lo0;
  let hi = Y_HI;
  for (let i = 0; i < 400; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (P(mid) > 0) lo = mid;
    else hi = mid;
  }
  // The bracket has closed to adjacent doubles (the price is monotone decreasing in the yield).
  return { yield: (lo + hi) / 2 };
}

function specRefusal(spec: BondSpec): string | null {
  if (!BOND_FREQS.includes(spec.freq)) return `Coupons per year must be 1, 2, 4 or 12 (got ${spec.freq}).`;
  if (!BOND_BASES.includes(spec.basis)) return "Choose a day-count basis.";
  if (!Number.isFinite(spec.rate) || spec.rate < 0 || spec.rate > 1) return "Coupon rate (%) must be between 0 and 100.";
  if (!Number.isFinite(spec.redemption) || spec.redemption <= 0 || spec.redemption > 10000) return "Redemption (per 100) must be a positive number up to 10,000.";
  if (!(spec.maturity > spec.settle)) return "Maturity date must be after the settlement date.";
  return null;
}

// ------------------------------------------------------------------------------------------------------------------
// Yield to call and yield to worst
// ------------------------------------------------------------------------------------------------------------------

export interface WorstResult {
  ytm: number;
  ytc: number;
  worst: "maturity" | "call";
  ytw: number;
  maturityPeriod: BondPeriod;
  callPeriod: BondPeriod;
}

/** Yield to maturity, to the call (redeemed at the call price on a coupon date) and the lower of the two. */
export function yieldToWorst(spec: BondSpec, clean: number, callDate: number, callPrice: number): WorstResult | Refusal {
  if (!Number.isFinite(callPrice) || callPrice <= 0 || callPrice > 10000) return refuse("Call price (per 100) must be a positive number up to 10,000.");
  const m = yieldFromClean(spec, clean);
  if ("error" in m) return refuse(`To maturity: ${m.error}`);
  const callSpec: BondSpec = { ...spec, redemption: callPrice, redeemOn: callDate };
  const c = yieldFromClean(callSpec, clean);
  if ("error" in c) return refuse(c.error.startsWith("Call date") ? c.error : `To the call: ${c.error}`);
  const mp = bondPeriod(spec) as BondPeriod;
  const cp = bondPeriod(callSpec) as BondPeriod;
  const worst = c.yield < m.yield ? "call" : "maturity";
  return { ytm: m.yield, ytc: c.yield, worst, ytw: Math.min(m.yield, c.yield), maturityPeriod: mp, callPeriod: cp };
}

// ------------------------------------------------------------------------------------------------------------------
// Treasury bills
// ------------------------------------------------------------------------------------------------------------------

export type BillYearBasis = "365" | "treasury";

export interface BillResult {
  days: number;
  price: number;
  /** Bank discount yield, ACT/360 on face. */
  discount: number;
  /** Money-market (CD-equivalent) yield, ACT/360 on price: Excel TBILLYIELD. */
  moneyMarket: number;
  /** Bond-equivalent (investment-rate) yield. */
  bey: number;
  /** The year length used for the BEY (365, or 366 when the Treasury convention applies). */
  yearDays: number;
  /** BEY by the Treasury's quadratic (more than a half year to maturity). */
  longForm: boolean;
}

/** True when a February 29 falls in (settle, settle + 1 year]. */
export function leapDayWithinYear(settle: number): boolean {
  const end = addMonthsClamped(settle, 12);
  const { y } = civilFromDay(settle);
  for (const yy of [y, y + 1]) {
    if (!isLeapYear(yy)) continue;
    const feb29 = civilDay(yy, 2, 29);
    if (feb29 > settle && feb29 <= end) return true;
  }
  return false;
}

/**
 * Treasury bill measures from a price per 100 or a bank discount rate.
 *   price = 100 × (1 − d × t/360)                                  (Excel TBILLPRICE)
 *   discount yield = (100 − P)/100 × 360/t
 *   money-market yield = (100 − P)/P × 360/t                       (Excel TBILLYIELD)
 *   bond-equivalent yield, t ≤ half a year: (100 − P)/P × B/t      (Excel TBILLEQ with B = 365)
 *   bond-equivalent yield, t > half a year: the Treasury's quadratic, P(1 + r/2)(1 + r(t − B/2)/B) = 100
 * B = 365, or (Treasury) 366 when a February 29 falls within the year after settlement.
 */
export function treasuryBill(o: { settle: number; maturity: number; price?: number; discount?: number; yearBasis: BillYearBasis }): BillResult | Refusal {
  const t = o.maturity - o.settle;
  if (!(t > 0)) return refuse("Maturity date must be after the settlement date.");
  if (o.maturity > addMonthsClamped(o.settle, 12)) return refuse("Maturity is more than one year after settlement; a Treasury bill matures within a year (Excel's TBILL functions refuse this too).");
  let P: number;
  if (o.price !== undefined) {
    if (!Number.isFinite(o.price) || o.price <= 0) return refuse("Price must be a positive number (per 100 of face).");
    if (o.price > 200) return refuse("Price per 100 above 200 is not a Treasury bill price; check the field.");
    P = o.price;
  } else {
    const d = o.discount as number;
    if (!Number.isFinite(d)) return refuse("Discount rate (%) must be a number.");
    P = 100 * (1 - (d * t) / 360);
    if (!(P > 0)) return refuse(`A discount rate of ${pctText(d)} over ${t} days gives a price at or below zero.`);
  }
  const B = o.yearBasis === "treasury" && leapDayWithinYear(o.settle) ? 366 : 365;
  const discount = ((100 - P) / 100) * (360 / t);
  const moneyMarket = ((100 - P) / P) * (360 / t);
  const longForm = t > Math.floor(B / 2);
  let bey: number;
  if (!longForm) bey = ((100 - P) / P) * (B / t);
  else {
    const a = t / (2 * B) - 0.25;
    const b = t / B;
    const c = (P - 100) / P;
    const disc = b * b - 4 * a * c;
    if (!(disc >= 0)) return refuse("The bond-equivalent yield has no real solution at that price.");
    bey = (-b + Math.sqrt(disc)) / (2 * a);
  }
  return { days: t, price: P, discount, moneyMarket, bey, yearDays: B, longForm };
}

// ------------------------------------------------------------------------------------------------------------------
// Small formatters (the engine's own refusal text)
// ------------------------------------------------------------------------------------------------------------------

function trueMinus(s: string): string {
  if (/^-0(?:\.0*)?%?$/.test(s)) return s.slice(1);
  return s.startsWith("-") ? "−" + s.slice(1) : s;
}
function pctText(x: number): string {
  return trueMinus((x * 100).toLocaleString("en-US", { maximumFractionDigits: 4 }) + "%");
}
function fmtPlain(x: number): string {
  return trueMinus(x.toLocaleString("en-US", { maximumFractionDigits: 6 }));
}
