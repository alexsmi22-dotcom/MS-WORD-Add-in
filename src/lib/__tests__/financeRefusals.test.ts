// Defect 0.31 — two Finance refusals that were silent.
//
// Bond maturity, reproduced verbatim: face 1000, coupon 5%, YTM 6%, semiannual.
// 10.25, 10.4 and 10.5 years ALL returned 922.92, because `Math.round(years*freq)`
// collapsed 20.5, 20.8 and 21 to 21. Three maturities, one price, nothing said why.
//
// Note which of the three is legitimate: 10.5 * 2 = 21 EXACTLY, so 10.5 years is a
// whole number of coupon periods and must keep pricing. Only 10.25 and 10.4 leave a
// partial period, which is an accrued-interest question — and accrued interest is a
// standing deliberate refusal here ("CLEAN price only").
//
// IRR, reproduced verbatim: irr([-1, 20]) returned null against a true IRR of 1900%,
// because the scan stopped at 10 (1000%) and nothing named that bound.

import {
  bondPrice,
  bondAnalytics,
  bondPeriodRefusal,
  bondYTM,
  MAX_COUPON_PERIODS,
  irr,
  IRR_SEARCH_MIN,
  IRR_SEARCH_MAX,
  IRR_SEARCH_RANGE_TEXT,
} from "../finance";

describe("defect 0.31 — bond maturity is not silently rounded to a whole coupon period", () => {
  it("10.5 years semiannual IS a whole number of periods and still prices at 922.92", () => {
    expect(bondPrice(1000, 0.05, 0.06, 10.5, 2)).toBeCloseTo(922.92, 2);
    expect(bondPeriodRefusal(10.5, 2)).toBeNull();
  });

  it("10.25 and 10.4 years leave a partial coupon period and are refused, not rounded", () => {
    expect(bondPrice(1000, 0.05, 0.06, 10.25, 2)).toBeNaN();
    expect(bondPrice(1000, 0.05, 0.06, 10.4, 2)).toBeNaN();
  });

  it("the refusal names the partial period and the nearest usable maturities", () => {
    const why = bondPeriodRefusal(10.25, 2);
    expect(why).not.toBeNull();
    expect(why!).toContain("20.5 coupon periods");
    expect(why!).toMatch(/accrued interest/i);
    expect(why!).toContain("are 10 and 10.5 years");
  });

  it("the refusal prints numbers, not float noise — output is a contract", () => {
    // At 3 coupons a year the advice read "the nearest whole-period maturities are
    // 2.3333333333333335 and 2.6666666666666665 years", which is not a number
    // anyone types into a field.
    const why = bondPeriodRefusal(2.5, 3)!;
    expect(why).not.toMatch(/\d\.\d{12,}/);
    expect(why).toContain("2.333333333");
    expect(why).toContain("2.666666667");
  });

  it("does not advise a maturity that is itself unpriceable", () => {
    // Below one whole coupon period there is nothing to price, so the lower
    // suggestion is dropped rather than offered as "0 years".
    const why = bondPeriodRefusal(0.2, 2)!;
    expect(why).toContain("nearest whole-period maturity is 0.5 years");
    expect(why).not.toContain(" 0 and ");
    expect(bondPrice(1000, 0.05, 0.06, 0.5, 2)).toBeGreaterThan(0);
  });

  it("bondAnalytics refuses the same input rather than pricing a different bond", () => {
    const a = bondAnalytics(1000, 0.05, 0.06, 10.25, 2);
    expect(a.price).toBeNaN();
    expect(a.macaulay).toBeNaN();
    expect(a.modified).toBeNaN();
    expect(a.convexity).toBeNaN();
    // The legitimate maturity is untouched.
    const b = bondAnalytics(1000, 0.05, 0.06, 10.5, 2);
    expect(b.price).toBeCloseTo(922.92, 2);
    expect(Number.isFinite(b.macaulay)).toBe(true);
  });

  it("a non-finite or absurd maturity is bounded, not looped over forever", () => {
    // The coupon loop had only a `periods < 1` guard, so Infinity — and 1e9, which a
    // fat-fingered entry produces just as easily — never returned. Measured: neither
    // completed in five million iterations. In a task pane that is a frozen Word.
    const t0 = Date.now();
    expect(bondPrice(1000, 0.05, 0.06, Infinity, 2)).toBeNaN();
    expect(bondPrice(1000, 0.05, 0.06, 1e9, 2)).toBeNaN();
    expect(bondAnalytics(1000, 0.05, 0.06, Infinity, 2).price).toBeNaN();
    expect(bondAnalytics(1000, 0.05, 0.06, 1e9, 2).price).toBeNaN();
    expect(Date.now() - t0).toBeLessThan(2000);
    // The message NAMES THE BAD ARGUMENT. It used to read "A maturity of 10
    // years is not a number of coupon periods" for bondPeriodRefusal(10, NaN) —
    // blaming a maturity that was fine — and interpolated the raw value, so
    // (NaN, 2) put the literal "NaN years" on screen.
    expect(bondPeriodRefusal(Infinity, 2)).toMatch(/Years to maturity must be a positive number/);
    expect(bondPeriodRefusal(10, NaN)).toMatch(/Coupons per year/);
    expect(bondPeriodRefusal(NaN, 2)).not.toMatch(/NaN/);
    expect(bondPeriodRefusal(1e9, 2)).toContain(String(MAX_COUPON_PERIODS));
    // The bound is generous: 6000 years of semiannual coupons still prices.
    expect(bondPeriodRefusal(6000, 2)).toBeNull();
  });

  it("whole-year and quarterly maturities are unaffected", () => {
    expect(bondPeriodRefusal(10, 2)).toBeNull();
    expect(bondPeriodRefusal(10.25, 4)).toBeNull(); // 10.25 * 4 = 41 exactly
    expect(bondPrice(1000, 0.05, 0.06, 10, 2)).toBeCloseTo(925.61, 2);
    expect(bondYTM(925.61, 1000, 0.05, 10, 2)).toBeCloseTo(0.06, 4);
  });
});

describe("defect 0.31 — IRR states the range it searched", () => {
  it("finds a venture-style 20x return (true IRR 1900%)", () => {
    const v = irr([-1, 20]);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(19, 6);
  });

  it("the searched range is stated, and names both bounds in percent", () => {
    expect(IRR_SEARCH_RANGE_TEXT).toContain("-99%");
    expect(IRR_SEARCH_RANGE_TEXT).toContain("10,000%");
    expect(IRR_SEARCH_MIN).toBe(-0.99);
    expect(IRR_SEARCH_MAX).toBe(100);
  });

  it("the stated range is the range actually searched", () => {
    // The text and the numbers are two facts that must not drift apart: a refusal
    // naming a bound the code does not use is worse than one naming none.
    expect(IRR_SEARCH_RANGE_TEXT).toContain(`${Math.round(IRR_SEARCH_MIN * 100)}%`);
    expect(IRR_SEARCH_RANGE_TEXT).toContain(`${(IRR_SEARCH_MAX * 100).toLocaleString("en-US")}%`);
  });

  it("still returns null when no rate in the range zeroes the NPV", () => {
    // All-positive flows never change sign at ANY rate, so this alone cannot tell a
    // ceiling of 10 from one of 100. The second case can: its only IRR is 19,900%,
    // which is above the stated ceiling — so it must refuse, and the refusal is what
    // IRR_SEARCH_RANGE_TEXT exists to explain.
    expect(irr([1, 2, 3])).toBeNull();
    expect(irr([-1, 200])).toBeNull();
    expect(irr([-1, 100])).not.toBeNull(); // 9,900%, just inside
  });

  it("keeps the deliberate multiple-IRR convention: the LOWEST root", () => {
    // -1 + 5/(1+r) - 6/(1+r)^2 = 0 has roots at 100% and 200%.
    const v = irr([-1, 5, -6]);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(1, 3);
  });

  it("the ordinary conventional case is unchanged", () => {
    const v = irr([-1000, 500, 500, 500]);
    expect(v!).toBeCloseTo(0.2334, 3);
  });

  it("a wider range does not become a frozen pane on a large pasted list", () => {
    // A BOUND ON THE RANGE IS NOT A BOUND ON THE TIME. Widening the ceiling from 10
    // to 100 at the original 0.5% step multiplies the npv evaluations by ten, and
    // each one is O(flows) over a field that accepts a paste. Measured in plain node
    // on 2,000 all-positive flows (no sign change, so the scan runs to the very end
    // — the worst case): 396 ms at the old ceiling, 662 ms two-phase, 2,650 ms at a
    // uniform fine step. At 20,000 flows the uniform version took 14 seconds, which
    // inside a task pane is not a slow answer but a frozen Word.
    //
    // COUNTED, NOT TIMED. The same measurement under ts-jest reads 3.6 s for the
    // 662 ms case, so any wall-clock threshold here is really a threshold on the
    // machine and the load — this repo already has one timing test that flakes that
    // way. The number of npv evaluations is the property that actually changed, and
    // it is exact: ~4,000 two-phase against ~20,200 uniform.
    let evaluations = 0;
    const counted = new Proxy(new Array(200).fill(1) as number[], {
      get(target, prop, receiver) {
        // npv reads cashflows[0] exactly once per call (t = 0), and .length once
        // per loop iteration — so index 0 is the evaluation counter, not length.
        if (prop === "0") evaluations++;
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(irr(counted)).toBeNull();
    expect(evaluations).toBeGreaterThan(3000);
    expect(evaluations).toBeLessThan(5000);
  });

  it("still finds a high root on the coarse half of the scan, at full precision", () => {
    // The bracket search above 1000% is coarse; the ANSWER is not — a sign change
    // is bisected either way.
    expect(irr([-1, 60])!).toBeCloseTo(59, 6);
    expect(irr([-1, 33])!).toBeCloseTo(32, 6);
  });
});
