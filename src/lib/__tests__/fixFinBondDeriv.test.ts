/**
 * fix-fin (2026-10-28): regressions pinned to reviewer R1's repros for the Fixed income and Derivatives calculators
 * (bondCalcs.ts, derivCalcs.ts).
 */
import { BOND_CALCS, billReading } from "../bondCalcs";
import { DERIV_CALCS, crrReading, parityHoldsAsPrinted, parityReading, strategyReading, carryReading } from "../derivCalcs";
import { analyzeStrategy } from "../derivatives";
import { calcById, checkedReading, runCalc, asObj } from "./fullFinLibHelpers";

const bond = (id: string) => calcById(BOND_CALCS, id);
const deriv = (id: string) => calcById(DERIV_CALCS, id);

describe("R1 #6: tbill-yields in price mode", () => {
  test("the discount rate left in the field (4.2) is refused as a price, naming the likely cause", () => {
    const o = asObj(runCalc(bond("tbill-yields"), { given: "price" }));
    expect(o.ok).toBe(false);
    expect(o.text).toContain("far from 100");
    expect(o.text).toContain("choose “discount rate” instead");
  });
  test("a real price reads 'the equivalent' discount rate, not 'the quoted' one", () => {
    const r = checkedReading(bond("tbill-yields"), { given: "price", value: "98.9" });
    expect(r).toContain("The equivalent");
    expect(r).not.toContain("quoted");
    expect(checkedReading(bond("tbill-yields"))).toContain("The quoted");
  });
  test("R1 #13: one day, not '1 days'", () => {
    expect(billReading({ price: 99.99, days: 1, discount: 0.036, moneyMarket: 0.036, bey: 0.0365 })).toContain("for 1 day returns");
  });
});

describe("R1 #10 / #13: bond-dates", () => {
  test("a yield of 10,000% that gives a negative clean price is refused", () => {
    const o = asObj(runCalc(bond("bond-dates"), { yld: "10000" }));
    expect(o.ok).toBe(false);
    expect(o.text).toContain("clean price is zero or below");
  });
  test("no 'roughly 7.858336 percent'", () => {
    const r = checkedReading(bond("bond-dates"));
    expect(r).not.toContain("roughly");
  });
});

describe("R1 #11 / #12: deriv-strategy", () => {
  test("a best case that is a loss reads 'loses at least'", () => {
    const a = analyzeStrategy([{ kind: "call", strike: 100, qty: 1, premium: 10 }, { kind: "call", strike: 100, qty: -1, premium: 0 }], 1);
    const r = strategyReading(a);
    expect(r).toContain("it loses at least 10.00");
    expect(r).not.toContain("at most −");
    const o = checkedReading(deriv("deriv-strategy"), { legs: "call, 100, 1, 10\ncall, 100, -1, 0" });
    expect(o).toContain("loses at least 10.00");
  });
  test("a stock leg's quantity is lots of the multiplier, and the text says how many shares", () => {
    const o = asObj(runCalc(deriv("deriv-strategy"), { legs: "stock, 50, 100", mult: "100" }));
    expect(o.text).toContain("long 100 lots of stock (10,000 shares) at 50");
    expect(o.text).toContain("every quantity, a stock leg's too, counts lots of the multiplier");
    expect(asObj(runCalc(deriv("deriv-strategy"), { legs: "stock, 50, 1", mult: "100" })).text).toContain("long 1 lot of stock (100 shares) at 50");
    expect(asObj(runCalc(deriv("deriv-strategy"), { legs: "stock, 50, 1" })).text).toContain("long 1 stock at 50");
  });
});

describe("R1 #13 / #14: parity, black76, carry, crr", () => {
  test("a violation of 0.00005 with equal printed sides reads as agreeing", () => {
    expect(parityHoldsAsPrinted(0.00005, 4.87714, 4.87709)).toBe(true);
    expect(parityReading(0.00005, 0, 4.87714, 4.87709)).toContain("agree with put–call parity");
    expect(parityReading(0.5, 0, 5.3771, 4.8771)).toContain("too expensive");
  });
  test("r = −100% over 100 years is refused, not a 397-character reading", () => {
    const o = asObj(runCalc(deriv("deriv-parity"), { t: "100", r: "-100" }));
    expect(o.ok).toBe(false);
    expect(o.text).toContain("outside this calculator");
  });
  test("the cost band reads 'the trading cost band of 10 per share'", () => {
    expect(checkedReading(deriv("deriv-parity"), { c: "10.45", p: "4.90", cost: "10" })).toContain("inside the trading cost band of 10 per share");
  });
  test("black76: 'a rise of 1', not 'each 1 rise'", () => {
    expect(checkedReading(deriv("deriv-black76"))).toContain("a rise of 1 in the futures price");
  });
  test("carry, reverse case: the amount is named", () => {
    const r = carryReading(100, 105, 0.05, 1, 0.05, 104, null);
    expect(r).toMatch(/earns that 1\.0000 at delivery/);
  });
  test("crr: an early-exercise premium that prints 0.0000 is not 'more … because exercising early pays'", () => {
    const r = crrReading("call", true, 50, { price: 1e12, earlyNodes: 3, firstEarlyStep: 4 }, 1e12 - 1e-6, 1e12);
    expect(r).not.toContain("0.0000 more");
    expect(r).toContain("adds too little to show");
  });
});
