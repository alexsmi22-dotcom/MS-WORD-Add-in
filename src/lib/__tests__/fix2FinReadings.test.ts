/**
 * Fix round 2, Finance (findings2-F.md): M1–M4 and MINOR 1–7, each pinned to the reviewer's repro.
 */
import { mcNpvCalc, mcStepOf } from "../ipValuation";
import { swrCalc, swrPct, swrSe } from "../forensicReports";
import { cipCalc } from "../cbaCalcs";
import { earReading, perpetuityReading, dcfRefusal, inNum, inPct } from "../finPaneReadings";
import { readXirrDates, XIRR_MAX_FLOWS } from "../xirrDates";
import { PREJUDGMENT_MAX_ROWS } from "../damagesInterest";
import { readingProblems } from "../calcReading";
import type { FinResult } from "../finCalc";

type Obj = Exclude<FinResult, string>;
const obj = (r: FinResult): Obj => {
  if (typeof r === "string") throw new Error(r);
  if (r.ok === false) throw new Error(r.text);
  return r;
};

describe("M1 + MINOR 7: safe-withdrawal Monte Carlo", () => {
  const base: Record<string, string> = { balance: "1000000", withdraw: "17000", years: "30", mean: "5", sd: "12", paths: "20000", seed: "1", table: "none" };
  const run = (over: Record<string, string> = {}): Obj => obj(swrCalc((k) => ({ ...base, ...over })[k] ?? ""));
  test("5 ruined paths of 20,000: the count, not '0%', and the SE to 2 significant figures", () => {
    const o = run();
    expect(o.text).toContain("Probability of ruin within 30 years: < 0.1% (5 of 20,000 paths ran out), simulation standard error about 0.011 percentage points");
    expect(o.reading).toBe(
      "Withdrawing 17,000.00 a year from 1,000,000.00 ran out of money within 30 years in 5 of 20,000 simulated return paths (under 0.1%), an estimate that rests on the return assumptions entered.",
    );
    expect(readingProblems(o.reading!)).toEqual([]);
    // table cells: "< 0.1%" where some paths ran out, never "0%"
    const col = o.tables![0].rows.slice(1).map((r) => r[1]);
    expect(col[col.length - 1]).toBe("< 0.1%");
    expect(col.every((c) => /^(< 0\.1%|\d+\.\d%)$/.test(c))).toBe(true);
  });
  test("one decimal throughout", () => {
    expect(swrPct(0.02)).toBe("2.0%");
    expect(swrPct(0.004)).toBe("0.4%");
    expect(swrPct(0)).toBe("0.0%");
    expect(swrPct(0.0003)).toBe("< 0.1%");
    expect(swrPct(0.9997)).toBe("> 99.9%");
    expect(swrPct(1)).toBe("100.0%");
    const o = run({ withdraw: "40000" });
    expect(o.text).toMatch(/Probability of ruin within 30 years: \d+\.\d%, simulation standard error about 0\.\d\d percentage points/);
  });
  test("the SE to 2 significant figures, including a round-up", () => {
    expect(swrSe(0.0003, 20000)).toBe("0.012");
    expect(swrSe(0.5, 20000)).toBe("0.35");
    // √(p(1 − p)/n) × 100 = 0.0999… → 0.10, not 0.100
    expect(swrSe(0.000999, 1000)).toBe("0.10");
  });
});

describe("M2 + MINOR 4 + MINOR 8: ipv-mc", () => {
  const base: Record<string, string> = { currency: "", revdist: "tri", rev: "2500000, 4000000, 6000000", growth: "3", ratedist: "tri", rate: "2, 4, 6", lifedist: "tri", life: "4, 8, 12", discdist: "logn", disc: "10, 18", tax: "21", cost: "600000", timing: "mid", attr: "none", samples: "50000", seed: "20261027" };
  const run = (over: Record<string, string> = {}): FinResult => mcNpvCalc((k) => ({ ...base, ...over })[k] ?? "");
  test("cost 714,106: the mean is rounded to the SE's magnitude, not 'Mean NPV 0.16 (SE 1,020)'", () => {
    const o = obj(run({ cost: "714,106" }));
    expect(o.text).toContain("Mean NPV: 0 (simulation standard error 1,000);");
    expect(o.text).toMatch(/P10 −\d{3},\d00; P50 −\d{2},\d00; P90 \d{3},\d00/);
    expect(o.reading).toMatch(/^After the price paid, the patent's NPV averages about 0, /);
    expect(readingProblems(o.reading!)).toEqual([]);
  });
  test("mcStepOf: the SE's second significant figure, never finer than the minor unit", () => {
    expect(mcStepOf(1020, 2)).toEqual({ step: 100, dp: 0 });
    expect(mcStepOf(3.4, 2)).toEqual({ step: 0.1, dp: 1 });
    expect(mcStepOf(0.0001, 2)).toEqual({ step: 0.01, dp: 2 });
    expect(mcStepOf(0, 2)).toBeUndefined();
  });
  test("every input fixed: exact to the cent, no float-noise spread, no 'about'", () => {
    const o = obj(run({ revdist: "fixed", rev: "4,000,000", ratedist: "fixed", rate: "4", lifedist: "fixed", life: "8", discdist: "fixed", disc: "12", cost: "100000" }));
    expect(o.text).toContain("Mean NPV: 625,880.37 (simulation standard error 0.00); standard deviation 0.00");
    expect(o.text).toContain("P10 625,880.37; P50 625,880.37; P90 625,880.37");
    expect(o.text).toContain("NPV at the central inputs (mode, median or fixed value): 625,880.37");
    expect(o.reading).toBe("After the price paid, the patent's NPV is 625,880.37 in every simulated outcome: with these inputs nothing varies. On these inputs none of the 50,000 simulated outcomes loses money.");
    expect(readingProblems(o.reading!)).toEqual([]);
  });
  test("a fixed '4,000,000' is one number; a fixed '1,500' is asked", () => {
    const ok = obj(run({ revdist: "fixed", rev: "4,000,000" }));
    expect(ok.text).toContain("fixed at 4,000,000.00");
    const asked = run({ revdist: "fixed", rev: "1,500" });
    expect(typeof asked !== "string" && asked.ok === false && asked.text).toMatch(/^First-year revenue: “1,500” reads three ways/);
    const pair = run({ revdist: "fixed", rev: "4,5" });
    expect(typeof pair !== "string" && pair.ok === false && pair.text).toMatch(/decimal comma/);
  });
});

describe("M3: fx-cip in JPY reports no arbitrage whose profit is JP¥0", () => {
  const base: Record<string, string> = { spot: "150", id: "0.5", if: "5", days: "90", dbasis: "360", fbasis: "360", comp: "simple", notional: "1000", base: "USD", quote: "JPY" };
  const run = (over: Record<string, string>): Obj => obj(cipCalc((k) => ({ ...base, ...over })[k] ?? ""));
  test("a deviation at the 6th decimal on 1,000 yen", () => {
    const o = run({ fwd: "148.333343" });
    expect(o.text).not.toMatch(/riskless profit/);
    expect(o.text).toContain("The deviation is too small to trade on this notional: the covered-arbitrage profit on");
    expect(o.text).toContain("in JPY's minor units, so parity holds in effect and there is no arbitrage worth taking.");
    // (the yen sign and its spacing come from currencyAmount, so they are matched loosely)
    expect(o.reading).toMatch(
      /^The quoted forward 148\.333343 differs from the parity forward 148\.333333 by a fraction of a basis point, too little to trade: the arbitrage profit on \S{1,4}\s?1,000\s\(JPY\) rounds to \S{1,4}\s?0\s\(JPY\), so there is no riskless arbitrage worth taking\.$/,
    );
    expect(o.text).toMatch(/rounds to \S{1,4}\s?0\s\(JPY\) in JPY's minor units/);
    expect(readingProblems(o.reading!)).toEqual([]);
  });
  test("a real deviation still reports the arbitrage", () => {
    const o = run({ fwd: "149", notional: "1000000" });
    expect(o.text).toMatch(/a riskless profit of/);
    expect(o.reading).toMatch(/above parity/);
  });
});

describe("M4 + MINOR 6: the caps fit a 30-year monthly XIRR and a 10-year daily prejudgment table", () => {
  test("361 monthly dates are read; the cap is 400", () => {
    expect(XIRR_MAX_FLOWS).toBe(400);
    const dates = Array.from({ length: 361 }, (_, i) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`).join("\n");
    const d = readXirrDates(dates);
    expect("error" in d).toBe(false);
  });
  test("prejudgment takes 5,000 rows", () => {
    expect(PREJUDGMENT_MAX_ROWS).toBe(5000);
  });
});

describe("MINOR 1–3, 5: the inline readings", () => {
  test("MINOR 1: a 0% nominal rate", () => {
    expect(earReading(0, 12)).toBe("A 0% nominal rate is also 0.00% effective: with no interest there is nothing to compound.");
  });
  test("MINOR 3: a tiny rate is echoed in significant digits, never '0%'", () => {
    expect(inNum(1e-7)).toBe("0.0000001");
    expect(inNum(-3e-9)).toBe("−0.000000003");
    expect(inPct(4e-7)).toBe("0.0000004%");
    expect(inNum(0)).toBe("0");
    expect(inNum(1234.5)).toBe("1,234.5");
  });
  test("MINOR 2: growth of 1e-7 that leaves the value unchanged to the cent", () => {
    expect(perpetuityReading(100, 5, 1e-7)).toBe(
      "A payment of 100.00 every period forever, starting next period, is worth 2,000.00 today at a 5% discount rate; changing by 0.0000001% a period it is still worth 2,000.00 to the cent.",
    );
    expect(perpetuityReading(100, 5, 2)).toMatch(/changing by 2% a period it is worth 3,333\.33, a value sensitive to the growth assumed\.$/);
  });
  test("MINOR 5: 5×10¹⁴ flows blame the flows, growth near the rate blames the growth", () => {
    expect(dcfRefusal(10, [5e14, 5e14, 5e14], 2)).toMatch(/the cash flows are too large/);
    expect(dcfRefusal(10, [1e12], 9.999)).toMatch(/terminal growth rate is too close to the discount rate/);
  });
});
