/**
 * "Fully inclusive" (2026-10-28): the plain-language reading of every Fixed income (bondCalcs.ts) and Derivatives
 * (derivCalcs.ts) calculator. Each case runs the calculator the pane's way, keeps the reading rules
 * (readingProblems), and every number in the reading is printed in the text or a table cell of the same result.
 * One case per wording branch, and the reading follows the input.
 */
import { BOND_CALCS } from "../bondCalcs";
import { DERIV_CALCS } from "../derivCalcs";
import { calcById, checkedReading, runCalc, asObj } from "./fullFinLibHelpers";

const bond = (id: string) => calcById(BOND_CALCS, id);
const deriv = (id: string) => calcById(DERIV_CALCS, id);

describe("every calculator's defaults carry a checked reading", () => {
  test.each([...BOND_CALCS, ...DERIV_CALCS].map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(checkedReading(c).length).toBeGreaterThan(40);
  });
});

describe("bond-dates", () => {
  const c = bond("bond-dates");
  test("discount, premium and par follow the price against the redemption", () => {
    expect(checkedReading(c)).toMatch(/below the 100\.0000 redemption/);
    expect(checkedReading(c, { yld: "3" })).toMatch(/above the 100\.0000 redemption/);
    expect(checkedReading(c, { coupon: "4", yld: "4", settle: "2026-02-15" })).toMatch(/equal to the 100\.0000 redemption/);
  });
  test("solving for the yield reads the same way and changes with the price", () => {
    const a = checkedReading(c, { solve: "yield" });
    const b = checkedReading(c, { solve: "yield", price: "92" });
    expect(a).toMatch(/clean price is 97\.250000 per 100/);
    expect(a).not.toBe(b);
    expect(b).toMatch(/lower the price by roughly [\d.]+ percent\.$/);
  });
});

describe("bond-ytw", () => {
  const c = bond("bond-ytw");
  test("a premium callable bond: the call is the worst case", () => {
    expect(checkedReading(c)).toMatch(/earned if the issuer calls the bond on February 15, 2029 at 101\.0000/);
  });
  test("a discount bond: maturity is the worst case", () => {
    expect(checkedReading(c, { price: "92" })).toMatch(/earned if the bond runs to maturity, below the [\d.]+% yield to call/);
  });
});

describe("tbill-yields", () => {
  const c = bond("tbill-yields");
  test("a positive discount rate understates the return", () => {
    expect(checkedReading(c)).toMatch(/understates the return/);
  });
  test("given a price the reading changes", () => {
    const r = checkedReading(c, { given: "price", value: "98.5" });
    expect(r).toMatch(/^Paying 98\.500000 per 100 for 91 days/);
  });
  test("a negative rate: the discount rate overstates; a zero rate: the measures agree", () => {
    expect(checkedReading(c, { value: "-1" })).toMatch(/overstates the return/);
    expect(checkedReading(c, { value: "0" })).toMatch(/the same as the 0\.000000% discount rate/);
  });
});

describe("curve-bootstrap", () => {
  const c = bond("curve-bootstrap");
  test("the default curve dips then rises", () => {
    const r = checkedReading(c);
    expect(r).toMatch(/dipping to/);
    expect(r).toMatch(/slopes upward overall/);
  });
  test("an inverted curve slopes downward; one instrument reads alone", () => {
    expect(checkedReading(c, { rows: "1\t5\n2\t4.5\n5\t4" })).toMatch(/slopes downward overall/);
    expect(checkedReading(c, { rows: "2\t4" })).toMatch(/^The zero rate is/);
  });
  test("a hump", () => {
    expect(checkedReading(c, { rows: "1\t4\n3\t5\n5\t4.2" })).toMatch(/peaking at/);
  });
});

describe("curve-nelson-siegel", () => {
  const c = bond("curve-nelson-siegel");
  test("the default fit and an inverted one", () => {
    expect(checkedReading(c)).toMatch(/R² = /);
    expect(checkedReading(c, { rows: "0.5\t5.5\n1\t5.2\n2\t4.8\n5\t4.3\n10\t4.0\n30\t3.9" })).toMatch(/slopes downward overall \(inverted\)/);
  });
  test("Svensson reads too", () => {
    expect(checkedReading(c, { model: "svensson" })).toMatch(/basis points/);
  });
});

describe("deriv-black76", () => {
  const c = deriv("deriv-black76");
  test("call and put move in opposite directions with the futures price", () => {
    expect(checkedReading(c)).toMatch(/^The call is worth [\d.]+; each 1 rise in the futures price raises it/);
    expect(checkedReading(c, { type: "put" })).toMatch(/lowers it/);
  });
  test("solving for volatility leads with it", () => {
    expect(checkedReading(c, { solve: "iv", price: "50" })).toMatch(/^The call price of 50\.0000 implies a volatility of [\d.]+% a year/);
  });
  test("a deep in-the-money put's time value can be positive", () => {
    const r = checkedReading(c, { type: "put", f: "100", k: "400", t: "2", r: "10", sig: "5" });
    expect(r).toMatch(/gains about/);
  });
});

describe("deriv-crr", () => {
  const c = deriv("deriv-crr");
  test("European: tree against the formula", () => {
    expect(checkedReading(c, { style: "european", type: "call" })).toMatch(/^The European call is worth about [\d.]+ on a 5-step tree, against/);
  });
  test("American put: the early-exercise premium; American call with no dividend: never early", () => {
    expect(checkedReading(c, { style: "american", type: "put" })).toMatch(/more than the same option without early exercise/);
    expect(checkedReading(c, { style: "american", type: "call" })).toMatch(/early exercise is never worth it/);
  });
  test("exercise now", () => {
    expect(checkedReading(c, { style: "american", type: "put", s: "10", k: "50" })).toMatch(/exercising now beats holding it/);
  });
});

describe("deriv-parity", () => {
  const c = deriv("deriv-parity");
  test("each branch", () => {
    expect(checkedReading(c)).toMatch(/^The (call|put) is [\d.]+ per share too expensive/);
    expect(checkedReading(c, { c: "14", p: "4" })).toMatch(/^The call is [\d.]+ per share too expensive against the put/);
    expect(checkedReading(c, { c: "8", p: "6" })).toMatch(/^The put is [\d.]+ per share too expensive against the call/);
    expect(checkedReading(c, { c: "14", p: "4", cost: "0.5" })).toMatch(/after the cost band\)\.$/);
    expect(checkedReading(c, { c: "10.45", p: "4.90", cost: "5" })).toMatch(/inside the 5 trading cost band/);
  });
  test("parity holding exactly", () => {
    // C − P = S − K·exp(−rt) with r = 0: 100 − 100 = 0.
    expect(checkedReading(c, { c: "5", p: "5", r: "0" })).toMatch(/agree with put–call parity/);
  });
});

describe("deriv-carry", () => {
  const c = deriv("deriv-carry");
  test("market above, below and at fair; no market", () => {
    expect(checkedReading(c)).toMatch(/higher, so buying the asset and selling the futures/);
    expect(checkedReading(c, { mkt: "1800" })).toMatch(/lower, so selling the asset/);
    expect(checkedReading(c, { mkt: "" })).toMatch(/a year\.$/);
  });
  test("an existing forward is valued when there is no market price", () => {
    expect(checkedReading(c, { mkt: "", deliv: "1700" })).toMatch(/worth [\d,.]+ to its holder today/);
    expect(checkedReading(c, { mkt: "", deliv: "2000" })).toMatch(/a liability of [\d,.]+ to its holder today/);
  });
  test("forward equal to spot", () => {
    expect(checkedReading(c, { r: "0", u: "0", stor: "0", mkt: "" })).toMatch(/equal to spot/);
  });
  test("the market price exactly at fair", () => {
    const o = asObj(runCalc(c, { r: "0", u: "0", stor: "0", mkt: "1800" }));
    expect(o.reading).toMatch(/agrees with it, so there is no carry arbitrage/);
  });
});

describe("deriv-strategy", () => {
  const c = deriv("deriv-strategy");
  test("the iron condor: a credit, bounded both ways, two breakevens", () => {
    const r = checkedReading(c);
    expect(r).toMatch(/^It brings in [\d.]+ up front; at expiry it makes at most [\d.]+ and it loses at most [\d.]+\. It breaks even at underlying prices of [\d.]+ and [\d.]+\.$/);
  });
  test("a long call: a debit, unlimited profit", () => {
    expect(checkedReading(c, { legs: "call, 100, 1, 5" })).toMatch(/^It costs 5\.00 up front; at expiry its profit is unlimited/);
  });
  test("a short call: unlimited loss", () => {
    expect(checkedReading(c, { legs: "call, 100, -1, 5" })).toMatch(/its loss is unlimited/);
  });
  test("a free collar that cannot lose", () => {
    expect(checkedReading(c, { legs: "stock, 100, 1\nput, 100, 1, 0\ncall, 120, -1, 0" })).toMatch(/at worst it breaks even/);
  });
});

describe("deriv-swap", () => {
  const c = deriv("deriv-swap");
  test("payer and receiver read opposite", () => {
    const pay = checkedReading(c);
    const rec = checkedReading(c, { side: "receive" });
    expect(pay).not.toBe(rec);
    expect(pay.includes("an asset") !== rec.includes("an asset")).toBe(true);
  });
  test("a fixed rate far above par is a liability to the payer", () => {
    expect(checkedReading(c, { fixed: "9" })).toMatch(/is a liability of [\d,.]+ to the fixed-rate payer/);
  });
});
