// Finance calculations for the Finance mode: time value of money, loans,
// discounted cash flow (NPV/IRR), growth, option pricing (Black-Scholes), and
// bond pricing. Pure numeric functions — no Office.js — fully unit-testable. The
// task pane formats and inserts the results.
//
// Rate conventions: rates are per-period decimals unless a function name says
// otherwise (e.g. compoundInterest takes an annual rate + compounds/year).

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
export function irr(cashflows: number[]): number | null {
  if (cashflows.length < 2) return null;
  const f = (r: number): number => npv(r, cashflows);
  const start = -0.99;
  const end = 10; // up to 1000%
  const step = 0.005; // 0.5% scan resolution
  let prevR = start;
  let prevV = f(start);
  if (prevV === 0) return prevR;
  for (let r = start + step; r <= end + 1e-9; r += step) {
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

/** Standard normal CDF via an Abramowitz–Stegun erf approximation (~1e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

export type OptionType = "call" | "put";

/** Black–Scholes price of a European option (no dividends). t in years. */
export function blackScholes(type: OptionType, S: number, K: number, t: number, r: number, sigma: number): number {
  if (t <= 0 || sigma <= 0) {
    const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return intrinsic;
  }
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  if (type === "call") return S * normCdf(d1) - K * Math.exp(-r * t) * normCdf(d2);
  return K * Math.exp(-r * t) * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Price of a coupon bond. `couponRate` and `ytm` are annual decimals; coupons pay
 * `freq` times per year for `years`.
 */
export function bondPrice(face: number, couponRate: number, ytm: number, years: number, freq = 2): number {
  const periods = Math.round(years * freq);
  if (periods < 1) return NaN;
  const coupon = (face * couponRate) / freq;
  const y = ytm / freq;
  let price = 0;
  for (let k = 1; k <= periods; k++) price += coupon / Math.pow(1 + y, k);
  price += face / Math.pow(1 + y, periods);
  return price;
}
