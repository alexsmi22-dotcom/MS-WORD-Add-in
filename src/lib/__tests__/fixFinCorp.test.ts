/**
 * fix-fin (2026-10-28): regressions pinned to reviewer R3's repros for the corporate, portfolio, accounting and
 * depreciation calculators (schedCalcs.ts, statements.ts, portcorpCalcs.ts, corpFinance.ts, loanSchedule.ts).
 */
import { SCHED_CALCS } from "../schedCalcs";
import { PORTCORP_CALCS, capmReading, varReading } from "../portcorpCalcs";
import { payback } from "../corpFinance";
import { readingProblems } from "../calcReading";
import { calcById, checkedReading, runCalc, asObj } from "./fullFinLibHelpers";

const sc = (id: string) => calcById(SCHED_CALCS, id);
const pc = (id: string) => calcById(PORTCORP_CALCS, id);

describe("R3 B1 / MINOR 11: MACRS straight line names the right peak", () => {
  test("basis 123,457, SL 5-year, half-year: the peak is year 2, a run of equal years", () => {
    const r = checkedReading(sc("macrs"), { basis: "123457", system: "sl", slperiod: "5", conv: "hy" });
    expect(r).not.toContain("from year 5");
    expect(r).toMatch(/a year at its peak, in years 2 to 5/);
  });
  test("SL 6.5-year alternates 15.39% and 15.38%: not 'a year' unless consecutive years print the same", () => {
    const r = checkedReading(sc("macrs"), { basis: "123457", system: "sl", slperiod: "6.5", conv: "hy" });
    expect(r).not.toMatch(/a year at its peak/);
    expect(r).toMatch(/at most [\d,.]+ in a year, first in year 2/);
  });
  test("the rate column and its total share one precision; the total is computed", () => {
    const o = asObj(runCalc(sc("macrs"), { system: "sl", slperiod: "6.5" }));
    const t = o.tables![0].rows;
    const dps = new Set(t.slice(1).map((r) => (r[1].split(".")[1] ?? "").replace("%", "").length));
    expect(dps.size).toBe(1);
  });
});

describe("R3 B3: negative equity", () => {
  const stmt = ["Net sales\t100", "Net income\t−10", "Total assets\t40", "Total liabilities\t90", "Shareholders’ equity\t−50", "Total current assets\t20", "Total current liabilities\t30"].join("\n");
  test("ROE, debt-to-equity and the equity multiplier are 'not meaningful (negative equity)', not 20.00%", () => {
    const o = asObj(runCalc(sc("fin-ratios"), { stmt }));
    expect(o.ok).not.toBe(false);
    const cells = o.tables!.flatMap((t) => t.rows.flat());
    expect(cells.join("|")).not.toContain("20.00%");
    const rows = o.tables![0].rows;
    for (const name of ["Return on equity", "Debt-to-equity", "Equity multiplier"]) expect(rows.find((r) => r[1] === name)![3]).toBe("not meaningful (negative equity)");
    expect(o.reading).toMatch(/^Shareholders’ equity is negative, so return on equity and debt-to-equity are not meaningful/);
    expect(readingProblems(o.reading)).toEqual([]);
  });
});

describe("R3 B5: discounted payback at an exact break-even", () => {
  test("−1,000 then 1,100 at 10% pays back in 1 period", () => {
    const disc = [-1000, 1100].map((c, t) => c / Math.pow(1.1, t));
    expect(payback(disc).at).toBe(1);
    const o = asObj(runCalc(pc("corp-capbudget"), { cfa: "-1000, 1100", cfb: "", rate: "10" }));
    expect(o.text).not.toContain("not reached");
  });
});

describe("R3 M2: Altman and CVP decide on the printed value", () => {
  test("Z″ printing 2.6000 is the grey zone, not 'safe, above the 2.60 cut-off'", () => {
    const stmt = ["Total current assets\t10", "Total current liabilities\t10", "Total assets\t100", "Retained earnings\t0", "Operating income\t0", "Total liabilities\t1.05", "Shareholders’ equity\t2.6"].join("\n");
    const o = asObj(runCalc(sc("altman-z"), { stmt, variant: "zdouble" }));
    expect(o.text).toContain("Z = 2.6000");
    expect(o.reading).toContain("grey zone");
  });
  test("cvp: an operating income of −0.02 is not 'exactly breaks even'", () => {
    const r = checkedReading(sc("cvp-breakeven"), { price: "1000000", vc: "0", fixed: "2000000000", units: "1999.99999998", target: "" });
    expect(r).not.toContain("breaks even, with");
    expect(r).toContain("below break-even");
  });
  test("cvp at a loss: the leverage line says the loss shrinks", () => {
    const o = asObj(runCalc(sc("cvp-breakeven"), { units: "1000" }));
    expect(o.text).toMatch(/at an operating loss: a 1% rise in sales shrinks the loss by [\d.]+%/);
    expect(o.svg ?? "").not.toContain("margin of safety: from break-even");
  });
});

describe("R3 M4 / p ≈ .05: portfolio readings", () => {
  test("port-var: a thin tail says so in the reading", () => {
    const r = varReading("one period", "4.000%", "4,000.00", "5.000%", "5,000.00", "100,000.00", "1.00%", false, "52 returns");
    expect(r).toContain("too few returns");
    expect(readingProblems(r)).toEqual([]);
  });
  test("port-capm: alpha p printed 0.0500 is borderline", () => {
    const r = capmReading(["Fund", "Market"], "1.1000", 0.9, 1.3, "2.000%", 0.05, "0.8000");
    expect(r).toContain("right at the conventional 5% threshold");
    expect(capmReading(["Fund", "Market"], "1.1000", 0.9, 1.3, "2.000%", 0.0499, "0.8000")).toContain("unlikely to be chance");
  });
});

describe("R3 MINOR 2 / 3 / 4 / 7 / 8 / 10: wording, grouping and refusals", () => {
  test("loan-schedule: a lump past the term names it, no '(got 60.00)'", () => {
    const o = asObj(runCalc(sc("loan-schedule"), { m: "1" }));
    expect(o.ok).toBe(false);
    expect(o.text).toContain("payment 60 is past the last of the 30 payments");
    expect(o.text).not.toContain("got");
    const w = asObj(runCalc(sc("loan-schedule"), { extrafrom: "2.5" }));
    expect(w.text).toBe("First payment with the extra principal must be a whole number.");
  });
  test("port-var: '1,000 periods'", () => {
    const o = asObj(runCalc(pc("port-var"), { horizon: "1000" }));
    expect(o.text).toContain("1,000 periods");
    expect(o.text).not.toMatch(/\b1000 periods/);
  });
  test("corp-dcf: negative net debt is 'Plus net cash'", () => {
    const o = asObj(runCalc(pc("corp-dcf"), { netdebt: "-100" }));
    const bridge = o.tables!.find((t) => t.label === "Enterprise value to equity value")!;
    expect(bridge.rows.map((r) => r[0])).toContain("Plus net cash (negative net debt)");
    expect(asObj(runCalc(pc("corp-dcf"), { shares: "1e15" })).ok).toBe(false);
  });
  test("corp-capbudget: the table's rate matches the text's", () => {
    const o = asObj(runCalc(pc("corp-capbudget")));
    expect(o.tables![0].rows.map((r) => r[0])).toContain("NPV at 10.000%");
  });
  test("fin-common-size refuses negative total assets", () => {
    const o = asObj(runCalc(sc("fin-common-size"), { stmt: "Net sales\t100\nTotal assets\t−50\nCash and equivalents\t10" }));
    expect(o.ok).toBe(false);
    expect(o.text).toContain("Total assets is negative");
  });
});
