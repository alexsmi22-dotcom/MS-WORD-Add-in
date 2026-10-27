/**
 * Derivatives (F1, gap item #7 and defects D1/D8) against scripts/deriv-oracle.py (fixtures/deriv-oracle.json):
 * QuantLib 1.44 AnalyticEuropeanEngine with a dividend yield (Black–Scholes–Merton price, Greeks, implied volatility),
 * blackFormula + AnalyticEuropeanEngine(S = F, q = r) for Black-76 (Greeks also finite-difference-checked in the
 * script), an independent numpy CRR on the pinned convention (QuantLib's "crr" differs in p, so it is used only for
 * the n = 2000 convergence check), brute-force grids for strategy payoffs, and QuantLib VanillaSwap on a user
 * DiscountCurve.
 *
 * Tolerances: BSM and Black-76 prices 1e-10 absolute (measured about 1e-13; the normal CDF is normalCdfPrecise since
 * D1); Greeks 1e-9 relative to max(1, |value|); implied volatility 1e-8; CRR prices and tree Greeks 1e-9 (same
 * arithmetic, different language); convergence at n = 2000 within 2e-3 of the analytic European price and within 1e-3
 * of QuantLib's CRR; strategy breakevens 1e-7 (brentq on a 1e-3 grid); swap values 1e-6 per 10 million notional,
 * par rates 1e-12.
 */
import * as fs from "fs";
import * as path from "path";
import { blackScholes, blackScholesGreeks, impliedVolatility, normCdf, sigmaZeroAtForward, type OptionType } from "../finance";
import { analyzeStrategy, black76, black76Implied, crrPrice, discountAt, forwardPrice, parityCheck, swapValue, type Leg } from "../derivatives";

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "deriv-oracle.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = any;
const named = (xs: R[], name: (x: R, i: number) => string): [string, R][] => xs.map((x, i) => [name(x, i), x]);
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));

test("the fixture is QuantLib 1.44's", () => {
  expect(FX.quantlib).toBe("1.44");
  expect(FX.generator).toBe("scripts/deriv-oracle.py");
});

describe("D1: normCdf is the precise normal CDF", () => {
  test("matches Python math.erfc to 1e-15", () => {
    const cases: [number, number][] = [
      [0, 0.5],
      [1, 0.8413447460685428],
      [-1, 0.15865525393145707],
      [1.96, 0.9750021048517796],
      [-3, 0.0013498980316300959],
      [-6, 9.865876450377016e-10],
    ];
    for (const [x, want] of cases) expect(Math.abs(normCdf(x) - want)).toBeLessThan(1e-15);
  });
  test("the gap analysis' measured ATM case is now exact to the oracle", () => {
    const atm = FX.bsm[0];
    expect(blackScholes("call", 100, 100, 1, 0.05, 0.2)).toBeCloseTo(atm.price, 12);
    expect(atm.price).toBeCloseTo(10.450583572185577, 12);
  });
});

describe.each(named(FX.bsm, (c: R, i: number) => c.note))("Black–Scholes–Merton %s", (_n, c: R) => {
  test("price, Greeks (incl. dividend rho) and implied volatility", () => {
    const type = c.type as OptionType;
    expect(Math.abs(blackScholes(type, c.S, c.K, c.t, c.r, c.sigma, c.q) - c.price)).toBeLessThan(1e-10);
    const g = blackScholesGreeks(type, c.S, c.K, c.t, c.r, c.sigma, c.q);
    expect(rel(g.delta, c.delta)).toBeLessThan(1e-9);
    expect(rel(g.gamma, c.gamma)).toBeLessThan(1e-9);
    expect(rel(g.vega, c.vega)).toBeLessThan(1e-9);
    expect(rel(g.theta, c.theta)).toBeLessThan(1e-9);
    expect(rel(g.rho, c.rho)).toBeLessThan(1e-9);
    expect(rel(g.psi, c.psi)).toBeLessThan(1e-9);
    if (c.iv !== null) {
      // The solver stops at |price error| < 1e-10, so the volatility error is that over vega: tight at the money,
      // looser deep in the money where the price barely moves with σ.
      const iv = impliedVolatility(type, c.price, c.S, c.K, c.t, c.r, c.q) as number;
      expect(Math.abs(blackScholes(type, c.S, c.K, c.t, c.r, iv, c.q) - c.price)).toBeLessThan(1e-9);
      expect(Math.abs(iv - c.iv)).toBeLessThan(Math.max(1e-8, 2e-10 / c.vega));
    }
  });
});

describe("D8: the dividend yield defaults to 0, so existing callers are unchanged", () => {
  test("omitting q equals q = 0; arity is still 6", () => {
    expect(blackScholes("put", 90, 100, 1, 0.05, 0.3)).toBe(blackScholes("put", 90, 100, 1, 0.05, 0.3, 0));
    expect(blackScholesGreeks("call", 90, 100, 1, 0.05, 0.3)).toEqual(blackScholesGreeks("call", 90, 100, 1, 0.05, 0.3, 0));
    expect(blackScholes.length).toBe(6);
    expect(impliedVolatility.length).toBe(6);
  });
  test("put–call parity with q: C − P = S·e^(−qt) − K·e^(−rt)", () => {
    const [S, K, t, r, q, s] = [100, 95, 1.5, 0.03, 0.045, 0.27];
    expect(blackScholes("call", S, K, t, r, s, q) - blackScholes("put", S, K, t, r, s, q)).toBeCloseTo(S * Math.exp(-q * t) - K * Math.exp(-r * t), 12);
  });
  test("σ = 0 limit with q: max(S·e^(−qt) − K·e^(−rt), 0), and the forward step moves with q", () => {
    expect(blackScholes("call", 100, 100, 1, 0.05, 0, 0.02)).toBeCloseTo(100 * Math.exp(-0.02) - 100 * Math.exp(-0.05), 12);
    expect(blackScholes("put", 100, 100, 1, 0.02, 0, 0.05)).toBeCloseTo(100 * Math.exp(-0.02) - 100 * Math.exp(-0.05), 12);
    // At S·e^(−qt) = K·e^(−rt) the Greeks are undefined.
    const S = 100 * Math.exp(0.03);
    expect(sigmaZeroAtForward(S, 100, 1, 0.02, 0, 0.05)).toBe(true);
    expect(sigmaZeroAtForward(S, 100, 1, 0.02, 0)).toBe(false);
    expect(blackScholesGreeks("call", S, 100, 1, 0.02, 0, 0.05).delta).toBeNaN();
    // Away from it: delta is e^(−qt) (call ITM forward), theta matches a finite difference of the σ = 0 price.
    const g = blackScholesGreeks("call", 120, 100, 1, 0.05, 0, 0.02);
    expect(g.delta).toBeCloseTo(Math.exp(-0.02), 14);
    const h = 1e-6;
    const fd = -(blackScholes("call", 120, 100, 1 + h, 0.05, 0, 0.02) - blackScholes("call", 120, 100, 1 - h, 0.05, 0, 0.02)) / (2 * h);
    expect(g.theta).toBeCloseTo(fd, 6);
  });
  test("a non-finite q is NaN, never a price", () => {
    expect(blackScholes("call", 100, 100, 1, 0.05, 0.2, NaN)).toBeNaN();
    expect(blackScholesGreeks("call", 100, 100, 1, 0.05, 0.2, Infinity).delta).toBeNaN();
  });
});

describe.each(named(FX.black76, (c: R, i: number) => c.note))("Black-76 %s", (_n, c: R) => {
  test("price and Greeks; implied volatility round trip", () => {
    const b = black76(c.type, c.F, c.K, c.t, c.r, c.sigma);
    if ("error" in b) throw new Error(b.error);
    expect(Math.abs(b.price - c.price)).toBeLessThan(1e-10);
    for (const k of ["delta", "gamma", "vega", "theta", "rho"] as const) expect(rel(b[k], c[k])).toBeLessThan(1e-9);
    expect(Math.abs((black76Implied(c.type, c.price, c.F, c.K, c.t, c.r) as number) - c.sigma)).toBeLessThan(1e-8);
  });
});

test("Black-76 refusals and the σ = 0 limit", () => {
  expect(black76("call", 0, 100, 1, 0.05, 0.2)).toEqual({ error: expect.stringContaining("Futures price F") });
  expect(black76("call", 100, 100, 0, 0.05, 0.2)).toEqual({ error: expect.stringContaining("Time to expiry") });
  expect(black76("call", 100, 100, 1, 0.05, 0)).toEqual({ error: expect.stringContaining("exactly at the money") });
  const b = black76("put", 90, 100, 2, 0.03, 0);
  if ("error" in b) throw new Error(b.error);
  expect(b.price).toBeCloseTo(10 * Math.exp(-0.06), 12);
  expect(b.delta).toBeCloseTo(-Math.exp(-0.06), 12);
  expect(black76Implied("call", 1e6, 100, 100, 1, 0.05)).toBeNull();
});

describe.each(named(FX.crr, (c: R, i: number) => c.note))("CRR %s", (_n, c: R) => {
  test("price, u, d, p, early-exercise node count and tree Greeks", () => {
    const res = crrPrice({ type: c.type, american: c.american, S: c.S, K: c.K, t: c.t, r: c.r, q: c.q, sigma: c.sigma, n: c.n });
    if ("error" in res) throw new Error(res.error);
    expect(Math.abs(res.price - c.price)).toBeLessThan(1e-9);
    expect(res.u).toBeCloseTo(c.u, 14);
    expect(res.d).toBeCloseTo(c.d, 14);
    expect(res.p).toBeCloseTo(c.p, 14);
    expect(res.earlyNodes).toBe(c.earlyNodes);
    if (c.n >= 2) {
      expect(Math.abs(res.delta - c.delta)).toBeLessThan(1e-9);
      expect(Math.abs(res.gamma - c.gamma)).toBeLessThan(1e-9);
      expect(Math.abs(res.theta - c.theta)).toBeLessThan(1e-7);
    } else {
      // One step: delta from step 1 exists; gamma and theta need step 2.
      expect(res.delta).toBeCloseTo((Math.max(c.S * c.u - c.K, 0) - Math.max(c.S * c.d - c.K, 0)) / (c.S * c.u - c.S * c.d), 12);
      expect(res.gamma).toBeNaN();
      expect(res.theta).toBeNaN();
    }
  });
});

test("Hull's 5-step American put reads 4.49, and the node values match his figure", () => {
  const res = crrPrice({ type: "put", american: true, S: 50, K: 50, t: 5 / 12, r: 0.1, q: 0, sigma: 0.4, n: 5, keepNodes: true });
  if ("error" in res) throw new Error(res.error);
  expect(res.price.toFixed(2)).toBe("4.49");
  const n = res.nodes!;
  expect(n[1].map((x) => x.v.toFixed(2))).toEqual(["6.96", "2.16"]);
  expect(n[3][0].early).toBe(true);
  expect(n[3][0].v.toFixed(2)).toBe("14.64");
});

describe.each(named(FX.convergence, (c: R, i: number) => `${c.american ? "American" : "European"} ${c.type} S ${c.S} K ${c.K}`))("convergence %s at n = 2000", (_n, c: R) => {
  test("pinned CRR equals the oracle's and sits beside QuantLib's CRR and the analytic price", () => {
    const res = crrPrice({ type: c.type, american: c.american, S: c.S, K: c.K, t: c.t, r: c.r, q: c.q, sigma: c.sigma, n: 2000 });
    if ("error" in res) throw new Error(res.error);
    expect(Math.abs(res.price - c.pinned)).toBeLessThan(1e-8);
    expect(Math.abs(res.price - c.quantlibCrr)).toBeLessThan(1e-3);
    if (!c.american) expect(Math.abs(res.price - c.analyticEuropean)).toBeLessThan(2e-3);
    else expect(res.price).toBeGreaterThan(c.analyticEuropean);
  });
});

test("CRR refusals name the input", () => {
  const base = { type: "put" as const, american: true, S: 100, K: 100, t: 1, r: 0.05, q: 0, sigma: 0.2, n: 50 };
  const err = (o: Partial<typeof base>): string => {
    const r = crrPrice({ ...base, ...o });
    return "error" in r ? r.error : "";
  };
  expect(err({ sigma: 0 })).toMatch(/Volatility must be above zero/);
  expect(err({ n: 0 })).toMatch(/Number of steps/);
  expect(err({ n: 2.5 })).toMatch(/whole number/);
  expect(err({ n: 1e9 })).toMatch(/at most 2,500/);
  expect(err({ n: Infinity })).toMatch(/Number of steps/);
  expect(err({ t: 0 })).toMatch(/Time to expiry/);
  expect(err({ S: NaN })).toMatch(/Spot price/);
  // p outside (0, 1): drift beyond the tree's step.
  expect(err({ r: 0.5, sigma: 0.05, n: 1, t: 1 })).toMatch(/outside \(0, 1\)/);
  expect(err({ r: -0.5, q: 0.4, sigma: 0.1, n: 1 })).toMatch(/outside \(0, 1\)/);
  expect(err({ sigma: 5, t: 100, n: 2500 })).toMatch(/too wide/);
});

test("CRR American put at the cap (2,500 steps) runs within 300 ms", () => {
  const t0 = Date.now();
  const r = crrPrice({ type: "put", american: true, S: 100, K: 100, t: 1, r: 0.05, q: 0, sigma: 0.2, n: 2500 });
  expect("error" in r).toBe(false);
  expect(Date.now() - t0).toBeLessThan(300);
});

describe.each(named(FX.parity, (c: R, i: number) => String(i)))("parity case %s", (_n, c: R) => {
  test("terms match", () => {
    const p = parityCheck(c.C, c.P, c.S, c.K, c.t, c.r, c.q);
    expect(p.lhs).toBeCloseTo(c.lhs, 12);
    expect(p.rhs).toBeCloseTo(c.rhs, 12);
    expect(p.violation).toBeCloseTo(c.violation, 12);
    expect(p.impliedForward).toBeCloseTo(c.impliedForward, 10);
  });
});

describe.each(named(FX.carry, (c: R, i: number) => String(i)))("carry case %s", (_n, c: R) => {
  test("forward price", () => {
    expect(rel(forwardPrice({ S: c.S, t: c.t, r: c.r, q: c.q, u: c.u, I: c.I, U: c.U }) as number, c.F)).toBeLessThan(1e-13);
  });
});

describe.each(named(FX.strategy, (c: R, i: number) => c.name))("strategy %s", (_n, c: R) => {
  test("breakevens, unbounded/bounded extremes, net premium", () => {
    const legs: Leg[] = c.legs.map((l: R) => ({ kind: l.kind, strike: l.strike, qty: l.qty, premium: l.premium }));
    const a = analyzeStrategy(legs, c.mult);
    expect(a.breakevens.length).toBe(c.breakevens.length);
    a.breakevens.forEach((b, i) => expect(Math.abs(b - c.breakevens[i])).toBeLessThan(1e-7));
    expect(a.slopeHigh).toBeCloseTo(c.slopeHigh, 9);
    if (c.maxProfit === null) expect(a.maxProfit.unbounded).toBe(true);
    else expect((a.maxProfit as { value: number }).value).toBeCloseTo(c.maxProfit, 9);
    if (c.maxLoss === null) expect(a.maxLoss.unbounded).toBe(true);
    else expect((a.maxLoss as { value: number }).value).toBeCloseTo(c.maxLoss, 9);
    expect(a.netPremium).toBeCloseTo(c.netPremium, 9);
  });
});

test("strategy edge cases: a flat zero range, a lone stock, a short stock's unlimited loss", () => {
  // Long and short the same call: profit identically zero.
  const z = analyzeStrategy([{ kind: "call", strike: 100, qty: 1, premium: 3 }, { kind: "call", strike: 100, qty: -1, premium: 3 }], 1);
  expect(z.zeroRanges).toEqual([[0, Infinity]]);
  expect(z.breakevens).toEqual([]);
  const st = analyzeStrategy([{ kind: "stock", strike: 40, qty: 1, premium: 0 }], 100);
  expect(st.breakevens).toEqual([40]);
  expect(st.maxProfit.unbounded).toBe(true);
  expect((st.maxLoss as { value: number }).value).toBeCloseTo(-4000, 9);
  const sh = analyzeStrategy([{ kind: "stock", strike: 40, qty: -1, premium: 0 }], 1);
  expect(sh.maxLoss.unbounded).toBe(true);
  expect((sh.maxProfit as { value: number }).value).toBe(40);
});

describe.each(named(FX.swap, (c: R, i: number) => c.note))("swap %s", (_n, c: R) => {
  test("value, legs and par rate vs QuantLib VanillaSwap", () => {
    const r = swapValue({ notional: c.notional, fixed: c.fixed, spread: c.spread, tenor: c.tenor, fixedFreq: c.fixedFreq, floatFreq: c.floatFreq, side: c.side, curve: c.curve });
    if ("error" in r) throw new Error(r.error);
    const tol = 1e-6 * (c.notional / 1e7);
    expect(Math.abs(r.value - c.value)).toBeLessThan(tol);
    expect(Math.abs(r.pvFixed - c.pvFixed)).toBeLessThan(tol);
    expect(Math.abs(r.pvFloat - c.pvFloat)).toBeLessThan(tol);
    expect(Math.abs(r.parRate - c.parRate)).toBeLessThan(1e-12);
    expect(r.annuity).toBeCloseTo(c.annuity, 12);
  });
});

test("swap refusals and curve interpolation", () => {
  const curve = FX.swap[0].curve;
  const base = { notional: 1e6, fixed: 0.04, spread: 0, tenor: 5, fixedFreq: 2, floatFreq: 4, side: "pay" as const, curve };
  expect(swapValue({ ...base, tenor: 12 })).toEqual({ error: expect.stringContaining("past the curve's last point") });
  expect(swapValue({ ...base, tenor: 5.1 })).toEqual({ error: expect.stringContaining("not a whole number of fixed-leg periods") });
  expect(swapValue({ ...base, tenor: 5.25, fixedFreq: 4, floatFreq: 2 })).toEqual({ error: expect.stringContaining("floating-leg") });
  // Log-linear: the geometric mean halfway between two knots; flat zero before the first knot.
  expect(discountAt(curve, 1.5)).toBeCloseTo(Math.sqrt(0.9605 * 0.921), 14);
  expect(discountAt(curve, 0.25)).toBeCloseTo(Math.sqrt(0.98), 14);
  expect(discountAt(curve, 10.5)).toBeNull();
});
