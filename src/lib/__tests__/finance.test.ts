import {
  futureValue,
  presentValue,
  compoundInterest,
  loanPayment,
  annuityPV,
  npv,
  irr,
  cagr,
  normCdf,
  blackScholes,
  bondPrice,
  effectiveAnnualRate,
  nominalAnnualRate,
  perpetuity,
  growingPerpetuity,
  growingAnnuityPV,
  amortizationSchedule,
  dcf,
  xnpv,
  xirr,
  bondYTM,
  bondAnalytics,
  blackScholesGreeks,
  impliedVolatility,
  straightLineDepreciation,
  decliningBalanceSchedule,
  annualizedReturn,
  stdev,
  annualizedVolatility,
  sharpeRatio,
} from "../finance";

describe("time value of money", () => {
  it("future and present value are inverses", () => {
    expect(futureValue(1000, 0.05, 10)).toBeCloseTo(1628.894627, 4);
    expect(presentValue(1628.894627, 0.05, 10)).toBeCloseTo(1000, 4);
  });
  it("compound interest with monthly compounding", () => {
    expect(compoundInterest(1000, 0.05, 12, 10)).toBeCloseTo(1647.0095, 3);
  });
  it("present value of an annuity", () => {
    expect(annuityPV(100, 0.05, 10)).toBeCloseTo(772.1735, 3);
    expect(annuityPV(100, 0, 10)).toBe(1000);
  });
});

describe("loanPayment", () => {
  it("computes a standard mortgage payment", () => {
    expect(loanPayment(200000, 0.05 / 12, 360)).toBeCloseTo(1073.6432, 3);
  });
  it("handles a zero-interest loan", () => {
    expect(loanPayment(1200, 0, 12)).toBe(100);
  });
});

describe("npv / irr", () => {
  const cf = [-1000, 500, 500, 500];
  it("computes NPV at a discount rate", () => {
    expect(npv(0.1, cf)).toBeCloseTo(243.426, 2);
    expect(npv(0, cf)).toBe(500);
  });
  it("computes IRR (NPV ≈ 0 at the IRR)", () => {
    const r = irr(cf)!;
    expect(r).toBeCloseTo(0.2334, 3);
    expect(npv(r, cf)).toBeCloseTo(0, 4);
  });
  it("returns null when there is no sign change", () => {
    expect(irr([100, 200, 300])).toBeNull();
  });
  it("returns null for degenerate cash-flow input", () => {
    expect(irr([])).toBeNull();
    expect(irr([100])).toBeNull();
  });
  it("finds a root for unconventional cash flows with multiple sign changes", () => {
    // [-1000, 2500, -1560] has IRRs near 20% and 30%; both zero the NPV.
    const r = irr([-1000, 2500, -1560])!;
    expect(r).not.toBeNull();
    expect(npv(r, [-1000, 2500, -1560])).toBeCloseTo(0, 4);
    expect(r).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(0.4);
  });
});

describe("cagr", () => {
  it("computes compound annual growth", () => {
    expect(cagr(1000, 2000, 10)).toBeCloseTo(0.071773, 5);
  });
});

describe("black-scholes", () => {
  it("matches the textbook ATM call value", () => {
    expect(blackScholes("call", 100, 100, 1, 0.05, 0.2)).toBeCloseTo(10.4506, 3);
  });
  it("satisfies put-call parity (C - P = S - K e^{-rt})", () => {
    const c = blackScholes("call", 100, 100, 1, 0.05, 0.2);
    const p = blackScholes("put", 100, 100, 1, 0.05, 0.2);
    expect(c - p).toBeCloseTo(100 - 100 * Math.exp(-0.05), 3);
  });
  it("normCdf is accurate at known points", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe("bondPrice", () => {
  it("prices a bond below par when ytm > coupon", () => {
    expect(bondPrice(1000, 0.05, 0.06, 10, 2)).toBeCloseTo(925.6131, 2);
  });
  it("prices at par when ytm = coupon", () => {
    expect(bondPrice(1000, 0.05, 0.05, 10, 2)).toBeCloseTo(1000, 4);
  });
  it("returns NaN rather than face value for a sub-period bond", () => {
    expect(Number.isNaN(bondPrice(1000, 0.05, 0.5, 0.2, 2))).toBe(true);
  });
});

describe("rate conversions", () => {
  it("EAR from a nominal rate and its inverse", () => {
    expect(effectiveAnnualRate(0.12, 12)).toBeCloseTo(0.126825, 5); // 12% comp. monthly
    expect(nominalAnnualRate(0.126825, 12)).toBeCloseTo(0.12, 5);
  });
});

describe("perpetuities & growing annuities", () => {
  it("level and growing perpetuities", () => {
    expect(perpetuity(100, 0.05)).toBe(2000);
    expect(growingPerpetuity(100, 0.08, 0.03)).toBeCloseTo(2000, 6); // 100/(0.08-0.03)
    expect(Number.isNaN(growingPerpetuity(100, 0.03, 0.05))).toBe(true); // g >= rate
  });
  it("growing annuity PV", () => {
    expect(growingAnnuityPV(100, 0.1, 0.05, 10)).toBeCloseTo(743.98, 1);
    expect(growingAnnuityPV(100, 0.05, 0.05, 10)).toBeCloseTo((100 * 10) / 1.05, 6); // rate == g
  });
});

describe("amortization schedule", () => {
  const rows = amortizationSchedule(200000, 0.05 / 12, 360); // 30y, 5% APR
  it("has one row per period and pays the loan to zero", () => {
    expect(rows).toHaveLength(360);
    expect(rows[359].balance).toBeCloseTo(0, 6);
  });
  it("first interest = balance × rate, principal sums to the loan", () => {
    expect(rows[0].interest).toBeCloseTo(200000 * (0.05 / 12), 6);
    const totalPrincipal = rows.reduce((a, r) => a + r.principal, 0);
    expect(totalPrincipal).toBeCloseTo(200000, 2);
    expect(rows[0].payment).toBeCloseTo(loanPayment(200000, 0.05 / 12, 360), 6);
  });
});

describe("DCF with terminal value", () => {
  it("discounts explicit flows", () => {
    expect(dcf(0.1, [100, 100, 100])).toBeCloseTo(248.685, 3);
  });
  it("adds a Gordon terminal value", () => {
    // 100/1.1 + (100·1.03/0.07)/1.1
    expect(dcf(0.1, [100], 0.03)).toBeCloseTo(1428.57, 2);
  });
});

describe("date-based XNPV / XIRR", () => {
  it("XNPV is zero at the true rate; XIRR recovers it", () => {
    expect(xnpv(0.1, [-1000, 1100], [0, 365])).toBeCloseTo(0, 6);
    expect(xirr([-1000, 1100], [0, 365])).toBeCloseTo(0.1, 4);
  });
});

describe("bond analytics", () => {
  it("YTM round-trips the price", () => {
    const p = bondPrice(1000, 0.05, 0.06, 10, 2);
    expect(bondYTM(p, 1000, 0.05, 10, 2)).toBeCloseTo(0.06, 5);
    expect(bondYTM(1000, 1000, 0.06, 10, 2)).toBeCloseTo(0.06, 5); // par bond
  });
  it("duration and convexity are sane", () => {
    const a = bondAnalytics(1000, 0.05, 0.05, 10, 1); // 10y annual par bond
    expect(a.price).toBeCloseTo(1000, 4);
    expect(a.macaulay).toBeCloseTo(8.108, 2);
    expect(a.modified).toBeCloseTo(a.macaulay / 1.05, 6);
    expect(a.convexity).toBeGreaterThan(0);
  });
});

describe("option Greeks & implied vol", () => {
  const S = 100, K = 100, t = 1, r = 0.05, sig = 0.2;
  it("ATM call Greeks match closed-form values", () => {
    const g = blackScholesGreeks("call", S, K, t, r, sig);
    expect(g.delta).toBeCloseTo(0.63683, 4);
    expect(g.gamma).toBeCloseTo(0.018762, 5);
    expect(g.vega).toBeCloseTo(37.524, 2);
    expect(blackScholesGreeks("put", S, K, t, r, sig).delta).toBeCloseTo(0.63683 - 1, 4);
  });
  it("implied vol recovers the input volatility", () => {
    const price = blackScholes("call", S, K, t, r, sig);
    expect(impliedVolatility("call", price, S, K, t, r)).toBeCloseTo(0.2, 4);
  });
});

describe("depreciation", () => {
  it("straight-line", () => {
    expect(straightLineDepreciation(10000, 1000, 5)).toBe(1800);
  });
  it("double-declining balance stops at salvage", () => {
    const rows = decliningBalanceSchedule(10000, 1000, 5, 2);
    expect(rows).toHaveLength(5);
    expect(rows[0].depreciation).toBeCloseTo(4000, 6); // 40% of 10000
    expect(rows[4].bookValue).toBeCloseTo(1000, 6); // never below salvage
  });
});

describe("return statistics", () => {
  it("annualized return from monthly returns", () => {
    const monthly = new Array(12).fill(0.01);
    expect(annualizedReturn(monthly, 12)).toBeCloseTo(0.126825, 5);
  });
  it("sample stdev and annualized volatility", () => {
    expect(stdev([1, 2, 3, 4, 5])).toBeCloseTo(1.5811, 4);
    expect(annualizedVolatility([1, 2, 3, 4, 5], 12)).toBeCloseTo(1.5811 * Math.sqrt(12), 3);
  });
  it("Sharpe ratio is finite for a positive-mean series", () => {
    const s = sharpeRatio([0.02, 0.01, 0.03, -0.01, 0.02], 0.001, 12);
    expect(Number.isFinite(s)).toBe(true);
  });
});

describe("bondAnalytics degenerate maturity", () => {
  test("periods < 1 returns a NaN struct instead of dividing by zero", () => {
    const r = bondAnalytics(1000, 0.05, 0.05, 0, 2);
    expect(Number.isNaN(r.macaulay)).toBe(true);
    expect(Number.isNaN(r.modified)).toBe(true);
    expect(Number.isNaN(r.convexity)).toBe(true);
  });
});
