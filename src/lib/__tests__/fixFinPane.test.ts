/**
 * fix-fin (2026-10-28): regressions pinned to the independent reviewers' repros for the Finance calculators written
 * inside taskpane.ts (FIN_CALCS). Nothing can import taskpane.ts, so each refusal and reading the pane entry makes is a
 * lib/finPaneReadings.ts function, and these call it with the reviewer's input.
 */
import * as R from "../finPaneReadings";
import { readingProblems } from "../calcReading";
import { irr, xirr, bondYTM, bondPrice, npv } from "../finance";
import { readXirrDates } from "../xirrDates";
import { postjudgmentReport } from "../damagesInterest";
import { finCurrencyCalc, FIN_CURRENCY_DEFAULTS } from "../econE5aCalcs";
import { finCurrencyWithFigure } from "../finPaneFigures";

const ok = (s: string | undefined): string => {
  expect(readingProblems(s)).toEqual([]);
  return s!;
};

describe("R1 #1 / #8: returns refuses what it cannot annualise", () => {
  const rets = [2, 1, 3, -1, 2, 1.5].map((x) => x / 100);
  test("periods a year zero or negative is refused by name", () => {
    expect(R.returnsRefusal(rets, 0, 0.1)).toMatch(/^Periods \/ year must be a positive number/);
    expect(R.returnsRefusal(rets, -12, 0.1)).toMatch(/^Periods \/ year/);
    expect(R.returnsRefusal(rets, NaN, 0.1)).toMatch(/^Periods \/ year/);
    expect(R.returnsRefusal(rets, 12, 0.1)).toBeUndefined();
  });
  test("one return, constant returns, a risk-free rate that is not a number", () => {
    expect(R.returnsRefusal([0.02], 12, 0.1)).toContain("at least two returns");
    expect(R.returnsRefusal([0.01, 0.01, 0.01], 12, 0.1)).toContain("do not vary");
    expect(R.returnsRefusal(rets, 12, NaN)).toContain("Risk-free");
  });
  test("R1 #9: the Sharpe ratio is the AVERAGE excess return per unit of volatility", () => {
    expect(ok(R.returnsReading(rets, 12, 0.1))).toContain("the average return above the risk-free rate per unit of that volatility");
  });
});

describe("R1 #2: the solvers stay quick and the readings do not solve again", () => {
  test("IRR caps the list at 1,000 flows, by name", () => {
    expect(R.irrFlowsRefusal(Array(1000).fill(1))).toBeUndefined();
    expect(R.irrFlowsRefusal(Array(1001).fill(1))).toBe(
      "The cash flows field holds 1,001 flows: this calculator takes at most 1,000, because the rate search runs over every flow.",
    );
  });
  test("XIRR caps the dates at 500", () => {
    const many = Array.from({ length: 501 }, (_, i) => String(i)).join("\n");
    const r = readXirrDates(many);
    expect("error" in r && r.error).toContain("at most 500");
  });
  test("the readings use the rate passed in (no second solve)", () => {
    const flows = [-1000, 500, 500, 500];
    // A rate that is not the IRR proves the reading used what it was given.
    expect(R.irrReading(flows, 0.5)).toContain("50.00%");
    expect(R.irrReading(flows, null)).toBeUndefined();
    expect(R.xirrReading(flows, [0, 365, 730, 1095], 0.25)).toContain("25.00%");
    expect(R.ytmReading(950, 1000, 5, 10, 2, 0.07)).toContain("7.00%");
    expect(R.ivReading("call", 10.45, 100, 100, 1, 5, 0, 0.3)).toContain("30.00%");
  });
  test("the faster IRR and YTM give the same roots as before (oracle values)", () => {
    expect(irr([-1000, 500, 500, 500])!).toBeCloseTo(0.2337519, 6);
    expect(irr([-1, 20])!).toBeCloseTo(19, 6);
    // numpy-financial: npf.irr([-100, 230, -132]) = 0.1 (the lowest root).
    expect(irr([-100, 230, -132])!).toBeCloseTo(0.1, 8);
    const y = bondYTM(950, 1000, 0.05, 10, 2)!;
    expect(bondPrice(1000, 0.05, y, 10, 2)).toBeCloseTo(950, 6);
    expect(bondYTM(1000, 1000, 0.05, 6000, 2)!).toBeCloseTo(0.05, 9);
    expect(bondYTM(950, 1000, 0.05, -10, -2)).toBeNull();
    // A root exists on the NPV the pane prints.
    expect(Math.abs(npv(irr([-1000, 300, 400, 500])!, [-1000, 300, 400, 500]))).toBeLessThan(1e-6);
    expect(xirr([-10000, 2750, 4250, 3250, 2750], [0, 60, 303, 411, 456])!).toBeCloseTo(0.373362535, 6);
  });
});

describe("R1 #5: inputs repeated as typed", () => {
  test("loan 6.875% stays 6.875%", () => {
    expect(ok(R.loanReading(200000, 6.875, 30, 12))).toContain("at 6.875% a year");
  });
  test("coupon, nominal, compound, growing annuity, perpetuity, iv price", () => {
    expect(ok(R.bondReading(1000, 5.125, 6, 10, 2))).toContain("its 5.125% coupon");
    expect(ok(R.ytmReading(950, 1000, 5.125, 10, 2))).toContain("5.125% coupon");
    expect(ok(R.earReading(6.875, 12))).toContain("6.875% nominal");
    expect(ok(R.compoundReading(1000, 4.375, 12, 10))).toContain("At 4.375% a year");
    expect(ok(R.gannReading(1000, 7.125, 2.5, 10))).toContain("a 7.125% discount rate");
    expect(ok(R.perpetuityReading(1000, 7.125, 2.5))).toContain("changing by 2.5% a period");
    expect(ok(R.ivReading("call", 10.4, 100, 100, 1, 5, 0))).toContain("A call price of 10.4 implies");
  });
});

describe("R1 #7: negative and zero periods", () => {
  test("negative periods and years are refused by name", () => {
    expect(R.periodCountRefusal(-10, "Years")).toBe("Years cannot be negative: it counts time forward from today.");
    expect(R.periodCountRefusal(-5, "Number of periods", true)).toContain("at least one payment");
    expect(R.periodCountRefusal(0, "Number of periods", true)).toContain("at least one payment");
    expect(R.periodCountRefusal(NaN, "Number of periods")).toBe("Number of periods must be a number.");
    expect(R.periodCountRefusal(0, "Number of periods")).toBeUndefined();
  });
  test("zero periods has its own sentence, not 'no discounting'", () => {
    const pv = ok(R.pvReading(1000, 5, 0));
    expect(pv).not.toContain("no discounting");
    expect(pv).toContain("in 0 periods");
    expect(ok(R.fvReading(1000, 5, 0))).toContain("no time to compound");
    expect(ok(R.compoundReading(1000, 5, 12, 0))).toContain("no time to compound");
  });
  test("pv at a tiny rate that prints the same is not 'no discounting'", () => {
    expect(ok(R.pvReading(1000, 0.0001, 1))).toContain("too small to show");
  });
});

describe("R1 #8: ear refuses a frequency of zero", () => {
  test("compounds a year 0 or negative", () => {
    expect(R.earRefusal(12, 0)).toMatch(/^Compounds \/ year must be a positive number/);
    expect(R.earRefusal(12, -1)).toMatch(/^Compounds \/ year/);
    expect(R.earRefusal(12, 12)).toBeUndefined();
    expect(R.earRefusal(-2400, 12.5)).toContain("no effective rate");
  });
});

describe("R1 #13: perpetuity reads plainly", () => {
  test("no 'Paid every period forever from next period'", () => {
    const r = ok(R.perpetuityReading(1000, 8, 3));
    expect(r).toMatch(/^A payment of 1,000\.00 every period forever, starting next period, is worth 12,500\.00 today/);
  });
});

describe("R3 B2 / MINOR 6: depreciation readings", () => {
  test("depr-sl: salvage 99.99 of 100 is a small charge, not 'salvage equal to cost'", () => {
    const r = ok(R.deprSlReading(100, 99.99, 5));
    expect(r).not.toContain("equal to cost");
    expect(r).toContain("less than a cent");
    expect(ok(R.deprSlReading(100, 100, 5))).toContain("salvage equal to cost");
  });
  test("depr: salvage reached in year 2 says year 2", () => {
    // 10,000 at factor 4 over 5 years: 8,000 off in year 1 hits the 2,000 salvage... take salvage 1,000.
    const r = ok(R.deprReading(10000, 1000, 5, 4));
    expect(r).toContain("salvage value in year 2");
    expect(r).not.toContain("by year 5");
  });
});

describe("R3 M1 / M5: inline depreciation guards", () => {
  test("life over 100, negative cost or salvage, cost zero", () => {
    expect(R.deprRefusal(10000, 1000, 1e9, 2)).toBe("Useful life must be at most 100 years, as in Depreciation schedule.");
    expect(R.deprRefusal(-10000, 0, 5, 2)).toBe("Cost must be a number above zero.");
    expect(R.deprRefusal(0, 0, 5)).toBe("Cost must be a number above zero.");
    expect(R.deprRefusal(10000, -1, 5)).toContain("Salvage value must be zero or more");
    expect(R.deprRefusal(10000, 20000, 5)).toContain("cannot exceed the cost");
    expect(R.deprRefusal(10000, 1000, 5, 0)).toContain("factor must be positive");
    expect(R.deprRefusal(10000, 1000, 100, 2)).toBeUndefined();
  });
});

describe("R3 M7 / MINOR 5: dcf", () => {
  test("no em dash, a magnitude cap, the growth as typed", () => {
    const g = R.dcfRefusal(10, [100], 12)!;
    expect(g).not.toContain("—");
    expect(g).toContain("above the terminal growth rate");
    expect(R.dcfRefusal(10, [1e300, 1e300], 3)).toContain("10¹⁵");
    expect(R.dcfRefusal(10, [100], 9.99999999999999)).toContain("too close");
    expect(R.dcfRefusal(10, [], 3)).toBe("Enter at least one cash flow.");
    expect(R.dcfRefusal(10, [100, 110, 121], 3)).toBeUndefined();
    expect(ok(R.dcfReading(10, [100, 110, 121], 9.999))).toContain("9.999% growth");
  });
});

describe("R2 MINOR: spelling, postjudgment at 0%, the currency as-of date", () => {
  test("recognized", () => {
    expect(R.panduitReading()).toContain("recognized");
  });
  test("postjudgment at a 0% rate says why there is no interest", () => {
    const f = { judgment: "2024-01-15", payment: "2025-01-15", amount: 100000, ratePct: 0, dayCount: "act365" };
    const out = postjudgmentReport(f);
    const r = ok(R.postjudgmentReading(out as never, f.payment, 0));
    expect(r).toContain("at a 0% rate no interest accrues");
    expect(r).not.toContain("of interest at");
  });
  test("the as-of date when it is a date; free text is not echoed", () => {
    const run = (asof: string) =>
      finCurrencyWithFigure(finCurrencyCalc((k: string) => ({ ...FIN_CURRENCY_DEFAULTS, asof })[k] ?? ""));
    expect(ok(run("2026-10-28").reading)).toContain("(as of 2026-10-28)");
    expect(ok(run("last Tuesday").reading)).not.toContain("Tuesday");
  });
});
