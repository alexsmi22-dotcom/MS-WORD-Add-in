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
