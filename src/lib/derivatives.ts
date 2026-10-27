/**
 * Derivatives engines (release F1, gap item #7): Black-76 on futures/forwards with Greeks and implied volatility; the
 * Cox–Ross–Rubinstein binomial tree (European and American); a put–call parity check on market prices; the
 * cost-of-carry forward price; multi-leg expiry payoff analysis; a plain-vanilla interest-rate swap valued on a
 * user discount curve. Pure numeric code, no Office.js; every result is a value or `{ error }` naming the input.
 *
 * Conventions pinned here (and printed by derivCalcs.ts):
 *  - rates r, dividend/convenience yield q and storage rate u are continuously compounded annual decimals; time in years.
 *  - CRR: u = e^{σ√Δt}, d = 1/u, p = (e^{(r−q)Δt} − d)/(u − d), one-step discount e^{−rΔt}; American exercise is
 *    checked at every node including today. (QuantLib's "crr" engine uses p = ½ + ½(r − q − σ²/2)Δt/(σ√Δt) instead,
 *    so it agrees only in the limit.)
 *  - Swap: payment times on a regular grid of 1/f years from today (a spot-starting swap valued on a reset date),
 *    accrual fraction 1/f per period, one curve for discounting and forwarding, discount factors log-linear in time
 *    between curve points (piecewise-flat continuous forwards), flat zero rate from today to the first point.
 */
import { normCdf, findRoot, type OptionType } from "./finance";

export type DerivError = { error: string };

const normPdf = (x: number): number => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

// ------------------------------------------------------------------------------------------------------------------
// Black-76
// ------------------------------------------------------------------------------------------------------------------

export interface Black76 {
  price: number;
  /** ∂V/∂F. */
  delta: number;
  /** ∂²V/∂F². */
  gamma: number;
  /** ∂V/∂σ per 1.00 of volatility. */
  vega: number;
  /** −∂V/∂(time to expiry) per year, F held fixed. */
  theta: number;
  /** ∂V/∂r per 1.00, F held fixed (= −t·V). */
  rho: number;
}

/** Black-76 price of a European option on a futures (or forward) price F; t > 0 for Greeks. */
export function black76(type: OptionType, F: number, K: number, t: number, r: number, sigma: number): Black76 | DerivError {
  if (!(F > 0) || !Number.isFinite(F)) return { error: "Futures price F must be a positive number." };
  if (!(K > 0) || !Number.isFinite(K)) return { error: "Strike K must be a positive number." };
  if (!(t > 0) || !Number.isFinite(t)) return { error: "Time to expiry must be above zero." };
  if (!Number.isFinite(r)) return { error: "Risk-free rate must be a finite number." };
  if (!(sigma >= 0) || !Number.isFinite(sigma)) return { error: "Volatility must be zero or more." };
  const disc = Math.exp(-r * t);
  const sign = type === "call" ? 1 : -1;
  if (sigma === 0) {
    const m = Math.log(F / K);
    if (Math.abs(m) <= 1e-12) return { error: "At σ = 0 with F = K the option is exactly at the money: delta jumps there and gamma is infinite, so the Greeks are undefined. Move F or K, or use a volatility above zero." };
    const itm = sign * m > 0 ? 1 : 0;
    const price = disc * Math.max(sign * (F - K), 0);
    return { price, delta: sign * disc * itm, gamma: 0, vega: 0, theta: r * price, rho: -t * price };
  }
  const sqt = Math.sqrt(t);
  const d1 = (Math.log(F / K) + (sigma * sigma * t) / 2) / (sigma * sqt);
  const d2 = d1 - sigma * sqt;
  const price = type === "call" ? disc * (F * normCdf(d1) - K * normCdf(d2)) : disc * (K * normCdf(-d2) - F * normCdf(-d1));
  const pdf = normPdf(d1);
  return {
    price,
    delta: type === "call" ? disc * normCdf(d1) : -disc * normCdf(-d1),
    gamma: (disc * pdf) / (F * sigma * sqt),
    vega: disc * F * pdf * sqt,
    theta: r * price - (disc * F * pdf * sigma) / (2 * sqt),
    rho: -t * price,
  };
}

/** Black-76 implied volatility from a price; null when no volatility in (0.01%, 500%) reproduces it. */
export function black76Implied(type: OptionType, price: number, F: number, K: number, t: number, r: number): number | null {
  if (!(price > 0) || !(F > 0) || !(K > 0) || !(t > 0) || !Number.isFinite(r)) return null;
  const f = (s: number): number => {
    const b = black76(type, F, K, t, r, s);
    return "error" in b ? NaN : b.price - price;
  };
  return findRoot(f, 1e-4, 5, 2000);
}

// ------------------------------------------------------------------------------------------------------------------
// Cox–Ross–Rubinstein binomial tree
// ------------------------------------------------------------------------------------------------------------------

/** Most steps priced (O(n²) work: 2,500 steps is about 3.1 million node updates per tree; an American price also runs the European tree and the convergence figure, all inside 300 ms). */
export const CRR_MAX_STEPS = 2500;
/** Most steps drawn as a tree (n + 1 nodes on the last level; past 6 the labels no longer fit a page width). */
export const CRR_FIGURE_STEPS = 6;

export interface CrrInput {
  type: OptionType;
  american: boolean;
  S: number;
  K: number;
  t: number;
  r: number;
  q: number;
  sigma: number;
  n: number;
  /** Keep every node (stock, value, early exercise) for the figure; only honoured for n ≤ CRR_FIGURE_STEPS. */
  keepNodes?: boolean;
}

export interface CrrResult {
  price: number;
  dt: number;
  u: number;
  d: number;
  p: number;
  /** Hull's tree Greeks (n ≥ 2): delta from step 1, gamma and theta from step 2; NaN when n < 2. */
  delta: number;
  gamma: number;
  theta: number;
  /** Number of nodes where early exercise beats continuation (American only; 0 otherwise). */
  earlyNodes: number;
  /** Earliest step at which some node exercises early (−1 when none). */
  firstEarlyStep: number;
  /** nodes[i][j]: step i, j up-moves (j = 0 … i); only when keepNodes and n ≤ CRR_FIGURE_STEPS. */
  nodes?: { s: number; v: number; early: boolean }[][];
}

/** Why a CRR input cannot be priced, or null. */
export function crrRefusal(o: CrrInput): string | null {
  if (!(o.S > 0) || !Number.isFinite(o.S)) return "Spot price S must be a positive number.";
  if (!(o.K > 0) || !Number.isFinite(o.K)) return "Strike K must be a positive number.";
  if (!(o.t > 0) || !Number.isFinite(o.t)) return "Time to expiry must be above zero (at expiry the value is the payoff itself).";
  if (o.t > 100) return "Time to expiry must be at most 100 years.";
  if (!Number.isFinite(o.r) || Math.abs(o.r) > 1) return "Risk-free rate must be between −100% and 100%.";
  if (!Number.isFinite(o.q) || Math.abs(o.q) > 1) return "Dividend yield must be between −100% and 100%.";
  if (!Number.isFinite(o.sigma) || !(o.sigma > 0)) return "Volatility must be above zero: at σ = 0 the tree has u = d = 1 and p is undefined (use the Black–Scholes σ = 0 limit instead).";
  if (o.sigma > 5) return "Volatility must be at most 500%.";
  if (!Number.isFinite(o.n) || !Number.isInteger(o.n) || o.n < 1) return "Number of steps must be a whole number of at least 1.";
  if (o.n > CRR_MAX_STEPS) return `Number of steps must be at most ${CRR_MAX_STEPS.toLocaleString("en-US")} (the tree is O(n²) work; ${o.n.toLocaleString("en-US")} steps would stall Word).`;
  const dt = o.t / o.n;
  const sd = o.sigma * Math.sqrt(dt);
  if (o.sigma * Math.sqrt(o.t * o.n) > 600) return "The tree is too wide to represent: σ√(t·n) exceeds 600, so the top node S·uⁿ overflows. Use fewer steps or check the volatility and time.";
  const u = Math.exp(sd);
  const d = 1 / u;
  const g = Math.exp((o.r - o.q) * dt);
  const p = (g - d) / (u - d);
  if (!(p > 0 && p < 1)) {
    return (
      `The risk-neutral probability p = (exp((r − q)Δt) − d)/(u − d) is ${Number(p.toPrecision(6)).toString().replace("-", "−")}, outside (0, 1): ` +
      `with Δt = t/n the drift (r − q)Δt is not inside the tree's ±σ√Δt step, so the tree admits arbitrage. ` +
      `Use more steps, a higher volatility, or a smaller |r − q|.`
    );
  }
  return null;
}

/** Prices a European or American option on a CRR tree. */
export function crrPrice(o: CrrInput): CrrResult | DerivError {
  const why = crrRefusal(o);
  if (why) return { error: why };
  const n = o.n;
  const dt = o.t / n;
  const sd = o.sigma * Math.sqrt(dt);
  const u = Math.exp(sd);
  const d = 1 / u;
  const p = (Math.exp((o.r - o.q) * dt) - d) / (u - d);
  const disc = Math.exp(-o.r * dt);
  const pu = disc * p;
  const pd = disc * (1 - p);
  const sign = o.type === "call" ? 1 : -1;
  // Stock at (i, j) = S·e^{(2j − i)σ√Δt}, from a table of the 2n + 1 possible exponents (not repeated products, so
  // rounding does not accumulate, and no exp() per node).
  const pw = new Float64Array(2 * n + 1);
  for (let k = -n; k <= n; k++) pw[k + n] = o.S * Math.exp(k * sd);
  const K = o.K;
  const tol = 1e-12 * Math.max(1, K);
  const keep = !!o.keepNodes && n <= CRR_FIGURE_STEPS;
  const nodes: { s: number; v: number; early: boolean }[][] | undefined = keep ? [] : undefined;
  const v = new Float64Array(n + 1);
  for (let j = 0; j <= n; j++) v[j] = Math.max(sign * (pw[2 * j] - K), 0);
  if (nodes) nodes[n] = Array.from({ length: n + 1 }, (_, j) => ({ s: pw[2 * j], v: v[j], early: false }));
  let earlyNodes = 0;
  let firstEarlyStep = -1;
  const level1: number[] = [];
  const level2: number[] = [];
  if (n === 1) for (let j = 0; j <= 1; j++) level1.push(v[j]);
  if (n === 2) for (let j = 0; j <= 2; j++) level2.push(v[j]);
  const american = o.american;
  for (let i = n - 1; i >= 0; i--) {
    const base = n - i; // pw index of node (i, 0); node (i, j) is base + 2j
    let earlyHere = false;
    const flags = nodes ? new Uint8Array(i + 1) : null;
    if (american) {
      for (let j = 0; j <= i; j++) {
        const cont = pu * v[j + 1] + pd * v[j];
        const ex = sign * (pw[base + 2 * j] - K);
        // Strictly better than continuing, beyond rounding: equal values are not "early exercise".
        if (ex > cont + tol) {
          v[j] = ex;
          earlyNodes++;
          earlyHere = true;
          if (flags) flags[j] = 1;
        } else v[j] = cont;
      }
      if (earlyHere) firstEarlyStep = i;
    } else {
      for (let j = 0; j <= i; j++) v[j] = pu * v[j + 1] + pd * v[j];
    }
    if (nodes) {
      nodes[i] = [];
      for (let j = 0; j <= i; j++) {
        const st = pw[base + 2 * j];
        nodes[i].push({ s: st, v: v[j], early: !!flags && flags[j] === 1 });
      }
    }
    if (i === 1) for (let j = 0; j <= 1; j++) level1.push(v[j]);
    if (i === 2) for (let j = 0; j <= 2; j++) level2.push(v[j]);
  }
  let delta = NaN;
  let gamma = NaN;
  let theta = NaN;
  if (level1.length === 2) delta = (level1[1] - level1[0]) / (o.S * u - o.S * d);
  if (level2.length === 3) {
    const [f20, f21, f22] = level2;
    const su2 = o.S * u * u;
    const sd2 = o.S * d * d;
    gamma = ((f22 - f21) / (su2 - o.S) - (f21 - f20) / (o.S - sd2)) / (0.5 * (su2 - sd2));
    theta = (f21 - v[0]) / (2 * dt);
  }
  return { price: v[0], dt, u, d, p, delta, gamma, theta, earlyNodes, firstEarlyStep, nodes };
}

// ------------------------------------------------------------------------------------------------------------------
// Put–call parity on market prices
// ------------------------------------------------------------------------------------------------------------------

export interface ParityCheck {
  /** C − P as quoted. */
  lhs: number;
  /** S·e^{−qt} − K·e^{−rt}. */
  rhs: number;
  /** lhs − rhs: > 0 the call is rich against the put (conversion), < 0 the put is rich (reversal). */
  violation: number;
  /** F implied by the prices: K + (C − P)·e^{rt}. */
  impliedForward: number;
  /** q implied by the prices, or NaN when C − P + K·e^{−rt} ≤ 0. */
  impliedQ: number;
}

export function parityCheck(C: number, P: number, S: number, K: number, t: number, r: number, q: number): ParityCheck {
  const lhs = C - P;
  const pvK = K * Math.exp(-r * t);
  const rhs = S * Math.exp(-q * t) - pvK;
  const arg = (lhs + pvK) / S;
  return { lhs, rhs, violation: lhs - rhs, impliedForward: K + lhs * Math.exp(r * t), impliedQ: arg > 0 ? -Math.log(arg) / t : NaN };
}

// ------------------------------------------------------------------------------------------------------------------
// Cost of carry
// ------------------------------------------------------------------------------------------------------------------

export interface CarryInput {
  S: number;
  t: number;
  r: number;
  /** Continuous income or convenience yield. */
  q: number;
  /** Continuous storage cost rate. */
  u: number;
  /** Present value of known cash income during the life (coupons, discrete dividends). */
  I: number;
  /** Present value of known storage costs during the life. */
  U: number;
}

/** F₀ = (S − I + U)·e^{(r − q + u)t}; an error when the carried spot S − I + U is not positive. */
export function forwardPrice(o: CarryInput): number | DerivError {
  const base = o.S - o.I + o.U;
  if (!(base > 0)) return { error: "Spot less the present value of income plus the present value of storage (S − I + U) must be above zero." };
  const F = base * Math.exp((o.r - o.q + o.u) * o.t);
  if (!Number.isFinite(F)) return { error: "The forward price overflows: check the rates and the time to delivery." };
  return F;
}

// ------------------------------------------------------------------------------------------------------------------
// Multi-leg expiry payoff
// ------------------------------------------------------------------------------------------------------------------

export type LegKind = "call" | "put" | "stock";
export interface Leg {
  kind: LegKind;
  /** Option strike, or the price paid (sold) for a stock leg. */
  strike: number;
  /** Signed: positive long, negative short. */
  qty: number;
  /** Option premium per unit (paid when long, received when short); 0 for stock. */
  premium: number;
}

export interface StrategyAnalysis {
  /** Profit at expiry as a function of the underlying (multiplier applied). */
  profit: (s: number) => number;
  /** Kinks: 0 and every option strike, ascending, unique. */
  kinks: number[];
  /** Slope of profit beyond the last kink (per unit of underlying, multiplier applied). */
  slopeHigh: number;
  /** Net premium paid (> 0 a debit, < 0 a credit), multiplier applied. */
  netPremium: number;
  maxProfit: { unbounded: true } | { unbounded: false; value: number; at: number[] };
  maxLoss: { unbounded: true } | { unbounded: false; value: number; at: number[] };
  /** Single breakeven prices and zero-profit ranges [a, b] (b may be Infinity). */
  breakevens: number[];
  zeroRanges: [number, number][];
}

export function analyzeStrategy(legs: Leg[], mult: number): StrategyAnalysis {
  const profit = (s: number): number => {
    let total = 0;
    for (const l of legs) {
      const pay = l.kind === "call" ? Math.max(s - l.strike, 0) : l.kind === "put" ? Math.max(l.strike - s, 0) : s - l.strike;
      total += l.qty * (pay - l.premium);
    }
    return total * mult;
  };
  const kinks = [...new Set([0, ...legs.filter((l) => l.kind !== "stock").map((l) => l.strike)])].sort((a, b) => a - b);
  let slopeHigh = 0;
  for (const l of legs) if (l.kind !== "put") slopeHigh += l.qty;
  slopeHigh *= mult;
  const qtyScale = legs.reduce((a, l) => a + Math.abs(l.qty), 0) * mult;
  const priceScale = Math.max(1, ...legs.map((l) => Math.abs(l.strike) + Math.abs(l.premium)));
  const slopeTol = 1e-12 * Math.max(1, qtyScale);
  const zeroTol = 1e-9 * Math.max(1, qtyScale) * priceScale;
  if (Math.abs(slopeHigh) <= slopeTol) slopeHigh = 0;
  const vals = kinks.map(profit).map((v) => (Math.abs(v) <= zeroTol ? 0 : v));
  const netPremium = legs.reduce((a, l) => a + l.qty * l.premium, 0) * mult;
  const extreme = (pick: (a: number, b: number) => boolean): { value: number; at: number[] } => {
    let best = vals[0];
    for (const v of vals) if (pick(v, best)) best = v;
    const tol = zeroTol;
    return { value: best, at: kinks.filter((_, i) => Math.abs(vals[i] - best) <= tol) };
  };
  const maxProfit = slopeHigh > 0 ? { unbounded: true as const } : { unbounded: false as const, ...extreme((a, b) => a > b) };
  const maxLoss = slopeHigh < 0 ? { unbounded: true as const } : { unbounded: false as const, ...extreme((a, b) => a < b) };
  const breakevens: number[] = [];
  const zeroRanges: [number, number][] = [];
  const pushPoint = (x: number): void => {
    if (zeroRanges.some(([a, b]) => x >= a - 1e-12 && x <= b + 1e-12)) return;
    if (!breakevens.some((b) => Math.abs(b - x) <= 1e-9 * Math.max(1, x))) breakevens.push(x);
  };
  for (let i = 0; i + 1 < kinks.length; i++) {
    const a = vals[i];
    const b = vals[i + 1];
    if (a === 0 && b === 0) {
      const last = zeroRanges[zeroRanges.length - 1];
      if (last && last[1] === kinks[i]) last[1] = kinks[i + 1];
      else zeroRanges.push([kinks[i], kinks[i + 1]]);
    }
  }
  const last = kinks.length - 1;
  if (vals[last] === 0 && slopeHigh === 0) {
    const lr = zeroRanges[zeroRanges.length - 1];
    if (lr && lr[1] === kinks[last]) lr[1] = Infinity;
    else zeroRanges.push([kinks[last], Infinity]);
  }
  for (let i = 0; i + 1 < kinks.length; i++) {
    const a = vals[i];
    const b = vals[i + 1];
    if (a === 0 && b === 0) continue;
    if (a === 0) pushPoint(kinks[i]);
    if (b === 0) pushPoint(kinks[i + 1]);
    else if (a !== 0 && Math.sign(a) !== Math.sign(b)) pushPoint(kinks[i] + (a * (kinks[i + 1] - kinks[i])) / (a - b));
  }
  if (kinks.length === 1 && vals[0] === 0 && slopeHigh !== 0) pushPoint(0);
  if (vals[last] !== 0 && slopeHigh !== 0 && Math.sign(slopeHigh) !== Math.sign(vals[last])) pushPoint(kinks[last] - vals[last] / slopeHigh);
  breakevens.sort((x, y) => x - y);
  return { profit, kinks, slopeHigh, netPremium, maxProfit, maxLoss, breakevens, zeroRanges };
}

// ------------------------------------------------------------------------------------------------------------------
// Plain-vanilla interest-rate swap on a user curve
// ------------------------------------------------------------------------------------------------------------------

export interface CurvePoint {
  t: number;
  df: number;
}

/** Discount factor at t: log-linear between points, (0, 1) as the anchor; null past the last point. */
export function discountAt(curve: CurvePoint[], t: number): number | null {
  if (t <= 0) return 1;
  const lastT = curve[curve.length - 1].t;
  if (t > lastT * (1 + 1e-12)) return null;
  let t0 = 0;
  let l0 = 0;
  for (const c of curve) {
    if (t <= c.t * (1 + 1e-12)) {
      const l1 = Math.log(c.df);
      if (c.t === t0) return c.df;
      const w = (Math.min(t, c.t) - t0) / (c.t - t0);
      return Math.exp(l0 + w * (l1 - l0));
    }
    t0 = c.t;
    l0 = Math.log(c.df);
  }
  return null;
}

export interface SwapInput {
  notional: number;
  /** Fixed rate, decimal. */
  fixed: number;
  /** Spread over the floating index, decimal (0.001 = 10 bp). */
  spread: number;
  tenor: number;
  fixedFreq: number;
  floatFreq: number;
  /** "pay": pay fixed, receive floating (a payer swap); "receive": the reverse. */
  side: "pay" | "receive";
  curve: CurvePoint[];
}

export interface SwapRow {
  t: number;
  df: number;
  fixed: number;
  float: number;
  forward: number;
}

export interface SwapResult {
  pvFixed: number;
  pvFloat: number;
  /** Value to the side named in the input. */
  value: number;
  parRate: number;
  /** Fixed-leg annuity Σ τ·D (per unit notional). */
  annuity: number;
  /** Change in value for a 1 bp rise in the fixed rate (to this side). */
  pv01: number;
  rows: SwapRow[];
}

export const SWAP_MAX_PERIODS = 1200;

export function swapValue(o: SwapInput): SwapResult | DerivError {
  const periods = (f: number): number | null => {
    const x = o.tenor * f;
    return Math.abs(x - Math.round(x)) <= 1e-9 * Math.max(1, x) && Math.round(x) >= 1 ? Math.round(x) : null;
  };
  const nFix = periods(o.fixedFreq);
  const nFlt = periods(o.floatFreq);
  if (nFix === null) return { error: `Swap tenor ${o.tenor} years is not a whole number of fixed-leg periods at ${o.fixedFreq} a year.` };
  if (nFlt === null) return { error: `Swap tenor ${o.tenor} years is not a whole number of floating-leg periods at ${o.floatFreq} a year.` };
  if (nFix > SWAP_MAX_PERIODS || nFlt > SWAP_MAX_PERIODS) return { error: `A leg has more than ${SWAP_MAX_PERIODS.toLocaleString("en-US")} periods; shorten the tenor or lower the frequency.` };
  const lastT = o.curve[o.curve.length - 1].t;
  if (o.tenor > lastT * (1 + 1e-12)) return { error: `The swap's last payment at ${o.tenor} years is past the curve's last point (${lastT} years); no extrapolation is done. Extend the curve.` };
  const times = new Map<number, SwapRow>();
  const key = (k: number, f: number): number => Math.round((k / f) * 1e9) / 1e9;
  const row = (t: number): SwapRow => {
    let r = times.get(t);
    if (!r) {
      r = { t, df: discountAt(o.curve, t) as number, fixed: 0, float: 0, forward: NaN };
      times.set(t, r);
    }
    return r;
  };
  let annuity = 0;
  for (let k = 1; k <= nFix; k++) {
    const r = row(key(k, o.fixedFreq));
    const tau = 1 / o.fixedFreq;
    r.fixed = o.notional * o.fixed * tau;
    annuity += tau * r.df;
  }
  let pvFloat = 0;
  for (let k = 1; k <= nFlt; k++) {
    const t0 = key(k - 1, o.floatFreq);
    const r = row(key(k, o.floatFreq));
    const tau = 1 / o.floatFreq;
    const d0 = discountAt(o.curve, t0) as number;
    const fwd = (d0 / r.df - 1) / tau;
    r.forward = fwd;
    r.float = o.notional * (fwd + o.spread) * tau;
    pvFloat += r.float * r.df;
  }
  const pvFixed = o.notional * o.fixed * annuity;
  const payerValue = pvFloat - pvFixed;
  const value = o.side === "pay" ? payerValue : -payerValue;
  const parRate = (pvFloat / o.notional) / annuity;
  const pv01 = (o.side === "pay" ? -1 : 1) * o.notional * annuity * 1e-4;
  if (![pvFixed, pvFloat, value, parRate].every(Number.isFinite)) return { error: "The swap value is not finite: check the curve and the notional." };
  const rows = [...times.values()].sort((a, b) => a.t - b.t);
  return { pvFixed, pvFloat, value, parRate, annuity, pv01, rows };
}
