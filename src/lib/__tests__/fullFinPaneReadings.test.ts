/**
 * "Fully inclusive" (2026-10-28): the plain-language readings of the 33 Finance calculators written inside
 * taskpane.ts (FIN_CALCS), built in lib/finPaneReadings.ts (nothing can import taskpane.ts in a test).
 *
 * For each calculator: the defaults carry a reading that keeps the rules (readingProblems = []), the reading changes
 * with the input, every wording branch is reached, and every number in the reading is either printed by the result
 * (in the same formatting) or an input echoed with the calculator's own formatter.
 *
 * WHERE "PRINTED" COMES FROM. The damages and currency calculators are lib functions, so their real text and table
 * cells are used. The older time-value calculators build their one-line text inside taskpane.ts; `printed` mirrors
 * those template lines exactly (`FV = ${finMoney(...)}` and so on), with the same formatters.
 */
import * as R from "../finPaneReadings";
import { readingProblems } from "../calcReading";
import { finMoney, finPct, finFixed } from "../financeFigures";
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
  annualizedReturn,
  annualizedVolatility,
  sharpeRatio,
  straightLineDepreciation,
  xirr,
} from "../finance";
import { finCurrencyCalc, FIN_CURRENCY_DEFAULTS } from "../econE5aCalcs";
import { prejudgmentReport, postjudgmentReport } from "../damagesInterest";
import { lostEarningsReport } from "../lostEarnings";
import {
  parsePeriodTable,
  reasonableRoyalty,
  lostProfits,
  damagesSummary,
  damagesToFin,
  georgiaPacificWorksheet,
  panduitWorksheet,
  SUMMARY_RESULT_COLUMNS,
  type LostProfitsInput,
  type RoyaltyInput,
} from "../patentDamages";
import { finCurrencyWithFigure } from "../finPaneFigures";

/** A number token: digits with grouping commas inside it ("1,628.89"), never a trailing sentence comma ("2026,"). */
const NUM = /\d(?:[\d,]*\d)?(?:\.\d+)?/g;

/** Every number token of the reading is a number token of the printed result or of the echoed inputs. */
function numbersPrinted(reading: string, printed: string[], inputs: string[] = []): string[] {
  const have = new Set([...printed, ...inputs].flatMap((s) => s.match(NUM) ?? []));
  return (reading.match(NUM) ?? []).filter((n) => !have.has(n));
}

function ok(reading: string | undefined): string {
  expect(readingProblems(reading)).toEqual([]);
  return reading!;
}

const cells = (o: { tables?: { rows: string[][] }[]; table?: { rows: string[][] } }): string[] =>
  [...(o.tables ?? []), ...(o.table ? [o.table] : [])].flatMap((t) => t.rows.flat());

// ---------------------------------------------------------------------------------------------------------------

describe("time value & loans", () => {
  test("fv: defaults, the number check, and grows / shrinks / stays", () => {
    const r = ok(R.fvReading(1000, 5, 10));
    expect(r).toContain("grows to 1,628.89");
    expect(numbersPrinted(r, [`FV = ${finMoney(futureValue(1000, 0.05, 10))}`], ["5%", finMoney(1000), "10"])).toEqual([]);
    expect(ok(R.fvReading(1000, -5, 10))).toContain("shrinks to");
    expect(ok(R.fvReading(1000, 0, 3))).toContain("stays at 1,000.00");
    expect(R.fvReading(1000, 5, 20)).not.toBe(r);
    expect(R.fvReading(NaN, 5, 10)).toBeUndefined();
  });

  test("pv: positive, zero and negative rates", () => {
    const r = ok(R.pvReading(1000, 5, 10));
    expect(r).toContain("is worth 613.91 today");
    expect(numbersPrinted(r, [`PV = ${finMoney(presentValue(1000, 0.05, 10))}`], [finMoney(1000), "10", "5%"])).toEqual([]);
    expect(ok(R.pvReading(1000, 0, 10))).toContain("worth the same");
    expect(ok(R.pvReading(1000, -3, 10))).toContain("negative rate");
    // A zero amount is not "no discounting".
    expect(ok(R.pvReading(0, 5, 10))).not.toContain("no discounting");
    expect(R.bondReading(0, 5, 6, 10, 2)).toBeUndefined();
  });

  test("compound: the frequency as typed", () => {
    const r = ok(R.compoundReading(1000, 5, 12, 10));
    expect(r).toContain("12×");
    expect(numbersPrinted(r, [`Amount = ${finMoney(compoundInterest(1000, 0.05, 12, 10))}`], ["5%", "12", finMoney(1000), "10"])).toEqual([]);
    expect(ok(R.compoundReading(1000, 5, 12.5, 1))).toContain("12.5×");
  });

  test("loan: the payment, a frequency word, and no interest sentence at 0%", () => {
    const r = ok(R.loanReading(200000, 5, 30, 12));
    expect(r).toMatch(/^Each monthly payment of 1,073\.64/);
    const pay = loanPayment(200000, 0.05 / 12, 360);
    expect(numbersPrinted(r, [`Payment = ${finMoney(pay)} per period`], [finMoney(200000), "5%", "30"])).toEqual([]);
    expect(ok(R.loanReading(200000, 0, 1, 1))).not.toContain("mostly interest");
    // Only when the first payment is more than half interest.
    expect(r).toContain("mostly interest");
    expect(ok(R.loanReading(200000, 3, 15, 12))).not.toContain("mostly interest");
    expect(ok(R.loanReading(200000, 5, 2, 3))).toContain("payment (3 a year)");
  });

  test("amort: interest on top, no interest, a negative rate", () => {
    const r = ok(R.amortReading(200000, 5, 30, 12));
    expect(r).toBe("Each monthly payment is 1,073.64; over 30 years that is 186,511.57 of interest on top of the 200,000.00 borrowed.");
    const s = amortizationSummary(200000, 0.05 / 12, 360);
    const text = [`Payment        ${finMoney(s.payment)} / period`, `Total interest ${finMoney(s.totalInterest)}`, `Total paid     ${finMoney(s.totalPaid)}`];
    expect(numbersPrinted(r, text, [finMoney(200000), "30"])).toEqual([]);
    expect(ok(R.amortReading(200000, 0, 30, 12))).toContain("no interest at all");
    expect(ok(R.amortReading(200000, -1, 30, 12))).toContain("paid in total");
  });

  test("ear: compounding gains, once a year, a negative rate (no 'interest earns interest')", () => {
    const r = ok(R.earReading(12, 12));
    expect(numbersPrinted(r, [`Effective annual rate = ${finPct(effectiveAnnualRate(0.12, 12))}`], ["12%", "12"])).toEqual([]);
    expect(r).toContain("interest earns interest");
    expect(ok(R.earReading(12, 1))).toContain("A 12% nominal rate compounded once a year is also 12.00% effective");
    // fix-fin R1 #5: the nominal rate as typed, not rounded to 2 decimals.
    expect(ok(R.earReading(6.875, 12))).toMatch(/^A 6\.875% nominal rate/);
    expect(ok(R.earReading(-12, 12))).not.toContain("interest earns interest");
    expect(ok(R.earReading(8, 12))).toMatch(/^An 8% /);
  });

  test("gann: the article follows the number", () => {
    const r = ok(R.gannReading(1000, 10, 5, 10));
    expect(numbersPrinted(r, [`PV = ${finMoney(growingAnnuityPV(1000, 0.1, 0.05, 10))}`], [finMoney(1000), "5%", "10", "10%"])).toEqual([]);
    expect(ok(R.gannReading(1000, 8, 5, 10))).toContain("at an 8% discount rate");
  });

  test("annuity", () => {
    const r = ok(R.annuityReading(1000, 5, 20));
    const text = [`Present value   ${finMoney(annuityPV(1000, 0.05, 20))}`, `Future value    ${finMoney(annuityFV(1000, 0.05, 20))}`, `Total paid in   ${finMoney(20000)}`];
    expect(numbersPrinted(r, text, ["20", finMoney(1000), "5%"])).toEqual([]);
    expect(ok(R.annuityReading(1000, 5, 1))).toMatch(/^1 payment of 1,000\.00 .* is worth/);
  });

  test("perpetuity: growth, none, decline", () => {
    const r = ok(R.perpetuityReading(1000, 8, 3));
    const text = [`Level perpetuity     ${finMoney(perpetuity(1000, 0.08))}`, `Growing perpetuity   ${finMoney(growingPerpetuity(1000, 0.08, 0.03))}`, `r = g: at ${finPct(0.03)} growth against ${finPct(0.08)} discount`];
    expect(numbersPrinted(r, text, [finMoney(1000), "8%", "3%"])).toEqual([]);
    expect(r).toContain("an 8% discount rate");
    expect(ok(R.perpetuityReading(1000, 8, 0))).toContain("with no growth");
    expect(ok(R.perpetuityReading(1000, 8, -2))).toContain("−2%");
  });

  test("rate-forms: continuous is the most any compounding gives, for a negative rate too", () => {
    const r = ok(R.rateFormsReading(10000, 6, 10, 12));
    const eff = effectiveAnnualRate(0.06, 12);
    const text = [
      `Continuous compounding   ${finMoney(continuousCompound(10000, 0.06, 10))}`,
      `Discrete, 12× per year     ${finMoney(10000 * Math.pow(1 + 0.06 / 12, 120))}`,
      `Effective annual rate    ${finPct(eff)}  (from ${finPct(0.06)} nominal)`,
      `Nominal behind it        ${finPct(nominalAnnualRate(eff, 12))}  (round-trips back)`,
    ];
    expect(numbersPrinted(r, text, [finMoney(10000), "10", "6%"])).toEqual([]);
    expect(r).toContain("the most any compounding can give");
    // e^r ≥ (1 + r/m)^m for every r: continuous is the ceiling at −6% as well.
    expect(ok(R.rateFormsReading(10000, -6, 10, 12))).toContain("the most any compounding can give");
    expect(ok(R.rateFormsReading(-10000, 6, 10, 12))).toContain("the least any compounding can give");
  });

  test("cagr: growth, decline, total loss, flat", () => {
    const r = ok(R.cagrReading(10000, 18000, 5));
    expect(numbersPrinted(r, [`CAGR  ${finPct(cagr(10000, 18000, 5))}`], [finMoney(10000), finMoney(18000), "5"])).toEqual([]);
    expect(r).toMatch(/^Growing/);
    expect(ok(R.cagrReading(10000, 8000, 5))).toMatch(/^Falling .* −4\.36%/);
    expect(ok(R.cagrReading(10000, 0, 5))).toContain("total loss");
    expect(ok(R.cagrReading(10000, 10000, 5))).toContain("no growth");
  });
});

describe("capital budgeting & valuation", () => {
  const flows = [-1000, 500, 500, 500];
  test("npv: positive, negative, breaks even (on the printed 0.00)", () => {
    const r = ok(R.npvReading(10, flows));
    expect(numbersPrinted(r, [`NPV = ${finMoney(npv(0.1, flows))}`], ["10%"])).toEqual([]);
    expect(r).toContain("adds value");
    expect(ok(R.npvReading(30, flows))).toContain("−91.94");
    expect(ok(R.npvReading(30, flows))).toContain("loses value");
    expect(ok(R.npvReading(0, [-1000, 500, 500]))).toContain("breaks even");
    expect(ok(R.npvReading(0, [-1000, 500, 500.001]))).toContain("breaks even");
    expect(R.npvReading(10, [])).toBeUndefined();
  });

  test("irr: an investment, a financing stream, several sign changes", () => {
    const r = ok(R.irrReading(flows));
    expect(numbersPrinted(r, [`IRR = ${finPct(irr(flows)!)}`])).toEqual([]);
    expect(r).toContain("cost of capital is lower");
    expect(ok(R.irrReading([1000, -600, -600]))).toContain("like a loan");
    expect(ok(R.irrReading([-100, 230, -132]))).toContain("change sign more than once");
  });

  test("xirr: a year, the same hedges", () => {
    const days = [0, 180, 299, 449];
    const cf = [-1000, 300, 400, 500];
    const r = ok(R.xirrReading(cf, days));
    expect(numbersPrinted(r, [`XIRR = ${finPct(xirr(cf, days)!)} / year`])).toEqual([]);
    expect(r).toContain("a year");
    expect(R.xirrReading(cf, [0, 1])).toBeUndefined();
    // The sign pattern is read in date order: typed out of order, an investment is still an investment.
    expect(ok(R.xirrReading([-1000, 500, 600], [0, 400, 200]))).toContain("cost of capital is lower");
  });

  test("dcf: terminal value mostly, half, the forecast mostly, negative", () => {
    const cf = [100, 110, 121];
    const r = ok(R.dcfReading(10, cf, 3));
    const v = dcf(0.1, cf, 0.03);
    const pvTv = (121 * 1.03) / 0.07 / Math.pow(1.1, 3);
    const text = [`Value = ${finMoney(v)}`, `PV of the explicit forecast (3 periods)`, `, ${finFixed((pvTv / v) * 100, 1)}% of the value`, "at period 3"];
    expect(numbersPrinted(r, text, [finPct(0.03)])).toEqual([]);
    expect(r).toContain("rests mostly");
    expect(ok(R.dcfReading(30, cf, 0))).toContain("forecast carries most");
    expect(ok(R.dcfReading(10, [-100, -110, -121], 3))).toContain("a scenario");
  });
});

describe("derivatives", () => {
  test("bs: call, put, worthless, at expiry", () => {
    const r = ok(R.bsReading("call", 100, 100, 1, 5, 20, 0));
    expect(numbersPrinted(r, [`Price = ${finMoney(blackScholes("call", 100, 100, 1, 0.05, 0.2, 0))}`], [finMoney(100), "1", "20%"])).toEqual([]);
    expect(r).toContain("right to buy");
    expect(ok(R.bsReading("put", 100, 100, 1, 5, 20, 0))).toContain("right to sell");
    expect(ok(R.bsReading("call", 10, 100, 0.1, 5, 20, 0))).toContain("not expected to finish in the money");
    expect(ok(R.bsReading("call", 120, 100, 0, 5, 20, 0))).toContain("At expiry this call is worth 20.00");
  });

  test("greeks: theta loses, theta gains", () => {
    const r = ok(R.greeksReading("call", 100, 100, 1, 5, 20, 0));
    const g = blackScholesGreeks("call", 100, 100, 1, 0.05, 0.2, 0);
    expect(numbersPrinted(r, [`Delta  ${finFixed(g.delta, 4)}`, `Theta  ${finFixed(g.theta / 365, 4)} per day`])).toEqual([]);
    expect(r).toContain("loses each day");
    expect(ok(R.greeksReading("put", 50, 100, 1, 10, 20, 0))).toContain("gains each day");
  });

  test("iv", () => {
    const r = ok(R.ivReading("call", 10.45, 100, 100, 1, 5, 0));
    expect(numbersPrinted(r, [`Implied vol = ${finPct(impliedVolatility("call", 10.45, 100, 100, 1, 0.05, 0)!)}`], [finMoney(10.45)])).toEqual([]);
    expect(R.ivReading("call", 12, 100, 100, 1, 5, 0)).not.toBe(r);
  });
});

describe("fixed income", () => {
  test("bond: discount, par (on the printed price), premium", () => {
    const r = ok(R.bondReading(1000, 5, 6, 10, 2));
    expect(numbersPrinted(r, [`Price = ${finMoney(bondPrice(1000, 0.05, 0.06, 10, 2))}`], [finMoney(1000), "5%", "6%"])).toEqual([]);
    expect(r).toContain("a discount");
    expect(ok(R.bondReading(1000, 5, 5, 10, 2))).toContain("(par)");
    expect(ok(R.bondReading(1000, 7, 5, 10, 2))).toContain("a premium");
    expect(ok(R.bondReading(1000, 5, 8, 10, 2))).toContain("At an 8% yield");
  });

  test("ytm: below, at and above face", () => {
    const r = ok(R.ytmReading(950, 1000, 5, 10, 2));
    expect(numbersPrinted(r, [`YTM = ${finPct(bondYTM(950, 1000, 0.05, 10, 2)!)}`], [finMoney(950), finMoney(1000), "5%"])).toEqual([]);
    expect(r).toContain("yield is above");
    expect(ok(R.ytmReading(1000, 1000, 5, 10, 2))).toContain("matches");
    expect(ok(R.ytmReading(1100, 1000, 5, 10, 2))).toContain("yield is below");
  });

  test("bondrisk", () => {
    const r = ok(R.bondriskReading(1000, 5, 6, 10, 2));
    const a = bondAnalytics(1000, 0.05, 0.06, 10, 2);
    const text = [`Price      ${finMoney(a.price)}`, `Modified   ${finFixed(a.modified, 3)} yrs`, `Convexity  ${finFixed(a.convexity, 2)}`];
    expect(numbersPrinted(r, text)).toEqual([]);
    expect(R.bondriskReading(1000, 5, 6, 20, 2)).not.toBe(r);
  });
});

describe("accounting", () => {
  test("depr: reaches salvage, stays above it, one year", () => {
    const r = ok(R.deprReading(10000, 1000, 5, 2));
    const rows = decliningBalanceSchedule(10000, 1000, 5, 2);
    const text = rows.map((x) => `Year ${x.year}:  dep ${finMoney(x.depreciation)}   book ${finMoney(x.bookValue)}`);
    expect(numbersPrinted(r, text, [finMoney(1000)])).toEqual([]);
    expect(r).toContain("reaches the 1,000.00 salvage value");
    expect(ok(R.deprReading(10000, 0, 5, 1.5))).toContain("above the 0.00 salvage value");
    expect(ok(R.deprReading(10000, 1000, 1, 2))).not.toContain("largest");
  });

  test("depr-sl: whole, fractional, over 60 years, nothing to depreciate", () => {
    const r = ok(R.deprSlReading(10000, 1000, 5));
    expect(numbersPrinted(r, [`Annual depreciation  ${finMoney(straightLineDepreciation(10000, 1000, 5))}`], [finMoney(10000), finMoney(1000), "5"])).toEqual([]);
    expect(ok(R.deprSlReading(10000, 1000, 7.5))).toContain("over 7.5 years");
    expect(ok(R.deprSlReading(10000, 1000, 75))).toContain("75.00 years");
    expect(ok(R.deprSlReading(10000, 10000, 5))).toContain("nothing to depreciate");
  });
});

describe("portfolio & risk", () => {
  test("returns: Sharpe positive, negative, undefined", () => {
    const rets = [2, 1, 3, -1, 2, 1.5].map((x) => x / 100);
    const r = ok(R.returnsReading(rets, 12, 0.1));
    const text = [
      `Annualized return  ${finPct(annualizedReturn(rets, 12))}`,
      `Annualized vol     ${finPct(annualizedVolatility(rets, 12))}`,
      `Sharpe ratio       ${finFixed(sharpeRatio(rets, 0.001, 12), 3)}`,
    ];
    expect(numbersPrinted(r, text)).toEqual([]);
    expect(r).toContain("per unit of that volatility");
    expect(ok(R.returnsReading([-0.02, 0.01, -0.03], 12, 0.1))).toContain("fell short");
    // A constant series: zero volatility, Sharpe undefined (the text prints "—"): the reading leaves Sharpe out.
    const c = ok(R.returnsReading([0.01, 0.01, 0.01], 12, 0.1));
    expect(c).toContain("no swings");
    expect(c).not.toContain("Sharpe");
    expect(ok(R.returnsReading([0.02], 12, 0.1))).not.toContain("volatility");
    expect(R.returnsReading([], 12, 0.1)).toBeUndefined();
  });
});

describe("articles", () => {
  test("a / an before a printed number", () => {
    expect(["8.00%", "11.00%", "18%", "11,000.00", "80%", "800"].map((s) => R.aAn(s))).toEqual(["an", "an", "an", "an", "an", "an"]);
    expect(["5.00%", "110%", "1,800.00", "−8.00%", "1.00%"].map((s) => R.aAn(s))).toEqual(["a", "a", "a", "a", "a"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("currency conversion (fin-currency)", () => {
  const run = (o: Record<string, string> = {}) =>
    finCurrencyWithFigure(finCurrencyCalc((k: string) => ({ ...FIN_CURRENCY_DEFAULTS, ...o })[k] ?? ""));
  test("defaults: the largest conversion, its cells verbatim", () => {
    const out = run();
    const r = ok(out.reading);
    expect(numbersPrinted(r, [out.text, ...cells(out)])).toEqual([]);
    expect(r).toContain("the largest conversion is");
    // Every cell quoted is a cell of the conversions table.
    const conv = R.currencyConversions(out)!;
    expect(conv.rows.some((row) => r.includes(row[0]) && r.includes(row[2]))).toBe(true);
  });
  test("one amount, none, and a refusal", () => {
    const one = run({ amounts: "100 GBP" });
    expect(ok(one.reading)).toMatch(/^At the rate you typed/);
    expect(numbersPrinted(one.reading!, [one.text, ...cells(one)])).toEqual([]);
    expect(ok(run({ amounts: "" }).reading)).toContain("No amounts were typed");
    const bad = run({ target: "XYZ" });
    expect(bad.ok).toBe(false);
    expect(bad.reading).toBeUndefined();
  });
});

describe("litigation damages", () => {
  const tranches = ["Date\tDamages", "2019-03-15\t125,000.00", "2020-12-31\t250,000.50", "2022-06-30\t98,765.43"].join("\n");
  const rates = ["From\tRate %", "2018-01-01\t5.00", "2020-07-01\t3.25", "2022-01-01\t7.50"].join("\n");

  test("prejudgment: interest, no interest, and the method words", () => {
    const out = prejudgmentReport({ tranches, rates, end: "2024-02-29", method: "annual", dayCount: "act365", midPeriod: "off" });
    const r = ok(R.prejudgmentReading(out, "2024-02-29", "annual"));
    expect(numbersPrinted(r, [out.text, ...cells(out)])).toEqual([]);
    expect(r).toContain("compounded annually");
    const simple = prejudgmentReport({ tranches, rates, end: "2024-02-29", method: "simple", dayCount: "act365", midPeriod: "off" });
    expect(ok(R.prejudgmentReading(simple, "2024-02-29", "simple"))).toContain("simple interest");
    const zero = prejudgmentReport({ tranches, rates: "2018-01-01\t0", end: "2024-02-29", method: "annual", dayCount: "act365", midPeriod: "off" });
    expect(ok(R.prejudgmentReading(zero, "2024-02-29", "annual"))).toMatch(/^No interest accrues/);
  });

  test("post-judgment", () => {
    const out = postjudgmentReport({ amount: 1500000, ratePct: 4.12, judgment: "2024-03-15", payment: "2026-10-24", dayCount: "act365" });
    const r = ok(R.postjudgmentReading(out, "2026-10-24", 4.12));
    expect(numbersPrinted(r, [out.text, ...cells(out)])).toEqual([]);
    const later = postjudgmentReport({ amount: 1500000, ratePct: 4.12, judgment: "2024-03-15", payment: "2027-10-24", dayCount: "act365" });
    expect(R.postjudgmentReading(later, "2027-10-24", 4.12)).not.toBe(r);
  });

  test("lost earnings: years and end age", () => {
    const f = { base: 65000, growthPct: 3, discountPct: 4.5, horizonMode: "years", horizon: 20, startAge: 45, consumptionPct: 0, fringePct: 22, midYear: "off" };
    const out = lostEarningsReport(f);
    const r = ok(R.lostEarningsReading(out, f));
    expect(numbersPrinted(r, [out.text, ...cells(out)])).toEqual([]);
    const byAge = { ...f, horizonMode: "age", horizon: 67.5 };
    const out2 = lostEarningsReport(byAge);
    const r2 = ok(R.lostEarningsReading(out2, byAge));
    expect(r2).toContain("Over 22.50 years");
    expect(numbersPrinted(r2, [out2.text, ...cells(out2)])).toEqual([]);
  });

  const royaltyRows = () => {
    const t = parsePeriodTable(["2021 4,000,000", "2022 5,500,000", "2023 6,250,000", "2024 3,100,000"].join("\n"), ["royalty base"], 1);
    if ("error" in t) throw new Error(t.error);
    return t.rows;
  };
  test("royalty: lump above, below, none; per unit; no apportionment", () => {
    const inp: RoyaltyInput = { rows: royaltyRows(), basis: "revenue", rate: 3, apportionPct: 40, lumpSum: 200000, discountPct: 8, periodsPerYear: 1 };
    const out = damagesToFin(reasonableRoyalty(inp));
    const r = ok(R.royaltyReading(inp));
    expect(numbersPrinted(r, [out.text, ...cells(out)])).toEqual([]);
    expect(r).toContain("above the running royalty's present value");
    expect(ok(R.royaltyReading({ ...inp, lumpSum: 150000 }))).toContain("below the running royalty's present value");
    const unit = { ...inp, basis: "unit" as const, rate: 0.5, apportionPct: 100, lumpSum: 0 };
    const ru = ok(R.royaltyReading(unit));
    expect(ru).toContain("no apportionment");
    expect(ru).not.toContain("lump");
    expect(numbersPrinted(ru, [damagesToFin(reasonableRoyalty(unit)).text])).toEqual([]);
  });

  const lpInput = (): LostProfitsInput => {
    const t = parsePeriodTable(["2022 12,000 30,000 5,000", "2023 15,000 32,000 6,000", "2024 9,000 28,000 6,000"].join("\n"), ["a", "b", "c"], 1);
    if ("error" in t) throw new Error(t.error);
    return {
      rows: t.rows, method: "share", captureSharePct: 60, patenteeSharePct: 40, infringerSharePct: 25, capacity: 0, marginMode: "price-cost",
      price: 120, cost: 70, margin: 50, erosion: true, butForPrice: 130, actualPrice: 120, elasticity: 0, remainder: "unit", remainderRate: 4, infringerPrice: 110,
    };
  };
  test("lost profits: all parts, lost profits alone, capacity", () => {
    const inp = lpInput();
    const out = damagesToFin(lostProfits(inp));
    const r = ok(R.lostProfitsReading(inp));
    expect(numbersPrinted(r, [out.text, ...cells(out)])).toEqual([]);
    expect(r).toContain("Spare capacity limited");
    const plain = { ...inp, erosion: false, remainder: "none" as const, rows: inp.rows.map((x) => ({ ...x, values: [x.values[0]] })) };
    const rp = ok(R.lostProfitsReading(plain));
    expect(rp).not.toContain("erosion");
    expect(rp).not.toContain("Spare capacity");
    expect(numbersPrinted(rp, [damagesToFin(lostProfits(plain)).text])).toEqual([]);
  });

  const summaryRows = (lines: string[]) => {
    const t = parsePeriodTable(lines.join("\n"), ["lost profits", "price erosion", "reasonable royalty", "interest"], 1, { allowNegative: [1], resultColumns: SUMMARY_RESULT_COLUMNS });
    if ("error" in t) throw new Error(t.error);
    return t.rows;
  };
  test("summary: plain, with a multiplier, with interest", () => {
    const rows = summaryRows(["2022 300,000 280,000 28,000", "2023 400,000 320,000 36,000", "2024 300,000 280,000 12,000"]);
    const o1 = damagesToFin(damagesSummary({ rows, multiplier: 1 }));
    const r1 = ok(R.damagesSummaryReading(o1, 1));
    expect(r1).toContain("over 3 periods");
    expect(numbersPrinted(r1, [o1.text, ...cells(o1)])).toEqual([]);
    const o2 = damagesToFin(damagesSummary({ rows, multiplier: 2 }));
    const r2 = ok(R.damagesSummaryReading(o2, 2));
    expect(r2).toContain("over 3 periods");
    expect(r2).toContain("$3,912,000.00");
    expect(numbersPrinted(r2, [o2.text, ...cells(o2)])).toEqual([]);
    const rowsI = summaryRows(["2022 300,000 280,000 28,000 5,000", "2023 400,000 320,000 36,000 6,000"]);
    const o3 = damagesToFin(damagesSummary({ rows: rowsI, multiplier: 1.5 }));
    const r3 = ok(R.damagesSummaryReading(o3, 1.5));
    expect(r3).toContain("the total is $2,057,000.00");
    expect(numbersPrinted(r3, [o3.text, ...cells(o3)])).toEqual([]);
    const o4 = damagesToFin(damagesSummary({ rows: rowsI, multiplier: 1 }));
    expect(ok(R.damagesSummaryReading(o4, 1))).toContain("With $11,000.00 of interest the total is $1,375,000.00.");
  });

  test("trillion-dollar inputs stay within the length rule", () => {
    const inp = lpInput();
    const big = { ...inp, price: 9_000_000, cost: 1, butForPrice: 9_000_010, actualPrice: 9_000_000, remainderRate: 9_000 };
    const r = R.lostProfitsReading(big);
    if (r) expect(readingProblems(r)).toEqual([]);
    const ri = { rows: royaltyRows().map((x) => ({ ...x, values: [x.values[0] * 1000] })), basis: "revenue" as const, rate: 99, apportionPct: 99.1234, lumpSum: 999_999_999_999, discountPct: 8.1234, periodsPerYear: 12 };
    const rr = R.royaltyReading(ri);
    if (rr) expect(readingProblems(rr)).toEqual([]);
  });

  test("the worksheets: a reading with the worksheet's own factor count", () => {
    const gp = ok(R.georgiaPacificReading());
    expect(numbersPrinted(gp, cells(georgiaPacificWorksheet()))).toEqual([]);
    const pd = ok(R.panduitReading());
    expect(numbersPrinted(pd, cells(panduitWorksheet()))).toEqual([]);
  });

  test("withReading never puts a reading on a refusal", () => {
    expect(R.withReading({ text: "no", ok: false }, "A reading.")).toEqual({ text: "no", ok: false });
    expect(R.withReading({ text: "yes" }, undefined)).toEqual({ text: "yes" });
    expect(R.withReading({ text: "yes" }, "A reading.").reading).toBe("A reading.");
  });
});
