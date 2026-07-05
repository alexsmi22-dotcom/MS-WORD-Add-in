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
  return rate === 0 ? NaN : pmt / rate;
}

/** PV of a growing perpetuity (Gordon): pmt / (rate − g); requires rate > g. */
export function growingPerpetuity(pmt: number, rate: number, g: number): number {
  return rate <= g ? NaN : pmt / (rate - g);
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
export function amortizationSchedule(principal: number, ratePerPeriod: number, nPeriods: number): AmortRow[] {
  const rows: AmortRow[] = [];
  if (nPeriods <= 0) return rows;
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

/** Yield to maturity that prices a coupon bond at `price` (annual, or null). */
export function bondYTM(price: number, face: number, couponRate: number, years: number, freq = 2): number | null {
  if (price <= 0) return null;
  return findRoot((y) => bondPrice(face, couponRate, y, years, freq) - price, -0.99, 2, 3000);
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

/** Price, Macaulay/modified duration, and convexity of a coupon bond. */
export function bondAnalytics(face: number, couponRate: number, ytm: number, years: number, freq = 2): BondRisk {
  const periods = Math.round(years * freq);
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
  /** ∂price/∂t, per year (negative = time decay). */
  theta: number;
  /** ∂price/∂r, per 1.00 change in rate. */
  rho: number;
}

/** Black–Scholes Greeks for a European option (no dividends). */
export function blackScholesGreeks(type: OptionType, S: number, K: number, t: number, r: number, sigma: number): Greeks {
  if (t <= 0 || sigma <= 0) return { delta: NaN, gamma: NaN, vega: NaN, theta: NaN, rho: NaN };
  const sqt = Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * t) / (sigma * sqt);
  const d2 = d1 - sigma * sqt;
  const pdf = normPdf(d1);
  const disc = K * Math.exp(-r * t);
  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * sqt);
  const vega = S * pdf * sqt;
  const theta =
    type === "call"
      ? (-S * pdf * sigma) / (2 * sqt) - r * disc * normCdf(d2)
      : (-S * pdf * sigma) / (2 * sqt) + r * disc * normCdf(-d2);
  const rho = type === "call" ? t * disc * normCdf(d2) : -t * disc * normCdf(-d2);
  return { delta, gamma, vega, theta, rho };
}

/** Implied volatility from an observed option `price` (annual decimal, or null). */
export function impliedVolatility(type: OptionType, price: number, S: number, K: number, t: number, r: number): number | null {
  if (price <= 0 || t <= 0) return null;
  return findRoot((sig) => blackScholes(type, S, K, t, r, sig) - price, 1e-4, 5, 2000);
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
  if (life <= 0) return rows;
  let book = cost;
  const rate = factor / life;
  for (let year = 1; year <= life; year++) {
    let dep = book * rate;
    if (book - dep < salvage) dep = Math.max(0, book - salvage);
    book -= dep;
    rows.push({ year, depreciation: dep, bookValue: book });
  }
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
