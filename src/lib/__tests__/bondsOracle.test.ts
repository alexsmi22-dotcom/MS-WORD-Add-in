/**
 * Fixed income on dates and yield curves (F1, gap items #3 and #16) against scripts/bonds-oracle.py
 * (fixtures/bonds-oracle.json: QuantLib 1.44 for ACT/ACT ICMA, 30/360 US and 30E/360 bonds; an independent
 * transcription of Microsoft's PRICE/ACCRINT formulas for ACT/360 and ACT/365 Fixed and the February-end 30/360 US
 * cases; Excel TBILL* and the Treasury quadratic for bills; scipy for the bootstrap and Nelson–Siegel/Svensson) and
 * Microsoft's own worked examples.
 *
 * Tolerances: prices and accrued interest 1e-8 relative (measured: about 1e-13); yields 1e-9 absolute; durations and
 * convexity 1e-8 relative; bootstrap zero rates 1e-12 absolute and discount factors 1e-12 relative; Nelson–Siegel SSE
 * 1e-9 relative and fitted yields 1e-7 (in %); Svensson SSE no worse than scipy's by 1e-6 relative.
 */
import * as fs from "fs";
import * as path from "path";
import { civilDay } from "../damagesInterest";
import {
  BondBasis,
  BondSpec,
  bondAtYield,
  bondPeriod,
  couponSchedule,
  days360E,
  days360US,
  treasuryBill,
  yieldFromClean,
  yieldToWorst,
  leapDayWithinYear,
} from "../bondDates";
import { bootstrapZeroCurve, fitNelsonSiegel } from "../yieldCurve";

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "bonds-oracle.json"), "utf8"));

const d = (s: string): number => {
  const [y, m, dd] = s.split("-").map(Number);
  return civilDay(y, m, dd);
};
const iso = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = any;
const named = (xs: R[], name: (x: R) => string): [string, R][] => xs.map((x) => [name(x), x]);
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));

interface Case {
  settle: string;
  maturity: string;
  rate: number;
  freq: number;
  basis: BondBasis;
  redemption: number;
  yield: number;
  note: string;
  clean: number;
  dirty: number;
  accrued: number;
  macaulay: number;
  modified: number;
  convexity: number;
  yieldFromClean: number;
  prev: string;
  next: string;
  N: number;
}

const spec = (c: Case): BondSpec => ({ settle: d(c.settle), maturity: d(c.maturity), rate: c.rate, redemption: c.redemption, freq: c.freq, basis: c.basis });

describe.each([...FX.bonds, ...FX.excel].map((c: Case) => [`${c.basis} ${c.note}`, c] as const))("%s", (_n, c) => {
  test("schedule, prices, accrued, durations", () => {
    const r = bondAtYield(spec(c), c.yield);
    if ("error" in r) throw new Error(r.error);
    expect(iso(r.period.schedule.prev)).toBe(c.prev);
    expect(iso(r.period.schedule.next)).toBe(c.next);
    expect(r.period.N).toBe(c.N);
    expect(rel(r.clean, c.clean)).toBeLessThan(1e-8);
    expect(rel(r.dirty, c.dirty)).toBeLessThan(1e-8);
    expect(rel(r.accrued, c.accrued)).toBeLessThan(1e-8);
    expect(rel(r.macaulay, c.macaulay)).toBeLessThan(1e-8);
    expect(rel(r.modified, c.modified)).toBeLessThan(1e-8);
    expect(rel(r.convexity, c.convexity)).toBeLessThan(1e-8);
  });
  test("yield back from the oracle's clean price", () => {
    const y = yieldFromClean(spec(c), c.clean);
    if ("error" in y) throw new Error(y.error);
    expect(Math.abs(y.yield - c.yieldFromClean)).toBeLessThan(1e-9);
    expect(Math.abs(y.yield - c.yield)).toBeLessThan(1e-9);
  });
});

test("the two oracles (QuantLib, Excel transcription) agree on every shared case", () => {
  expect(FX.crossCheckMaxAbs).toBeLessThan(1e-9);
});

describe("30/360 day counts", () => {
  test.each(named(FX.days360, (r) => `${r.d1} to ${r.d2}`))("%s", (_a, r) => {
    expect(days360US(d(r.d1), d(r.d2))).toBe(r.excel);
    expect(days360E(d(r.d1), d(r.d2))).toBe(r.qlEuropean);
  });
  test("Excel basis 0 differs from QuantLib Thirty360.USA (SIA) only when D1 is February's last day and D2 a 31st", () => {
    const diffs = FX.days360.filter((r: { excel: number; qlUSA: number }) => r.excel !== r.qlUSA).map((r: { d1: string; d2: string }) => [r.d1, r.d2]);
    expect(diffs).toEqual([
      ["2027-02-28", "2027-03-31"],
      ["2028-02-29", "2028-08-31"],
    ]);
  });
});

describe("Microsoft worked examples", () => {
  const H = FX.hand;
  test("PRICE: 94.63 (94.63436162 to 8 dp)", () => {
    const r = bondAtYield({ settle: d(H.price.settle), maturity: d(H.price.maturity), rate: H.price.rate, redemption: 100, freq: 2, basis: "30360us" }, H.price.yld);
    if ("error" in r) throw new Error(r.error);
    expect(r.clean.toFixed(2)).toBe("94.63");
    expect(r.clean).toBeCloseTo(94.63436162, 8);
  });
  test("YIELD: 0.065 from 95.04287", () => {
    const y = yieldFromClean({ settle: d(H.yieldEx.settle), maturity: d(H.yieldEx.maturity), rate: H.yieldEx.rate, redemption: 100, freq: 2, basis: "30360us" }, H.yieldEx.price);
    if ("error" in y) throw new Error(y.error);
    expect(Math.abs(y.yield - 0.065)).toBeLessThan(1e-7); // the price is given to 5 dp
  });
  test("ACCRINT: 16.666667 on 1,000 (60 days of 30/360 at 10%)", () => {
    const r = bondAtYield({ settle: d(H.accrint.settle), maturity: civilDay(2010, 9, 1), rate: 0.1, redemption: 100, freq: 2, basis: "30360us" }, 0.05);
    if ("error" in r) throw new Error(r.error);
    expect(iso(r.period.schedule.prev)).toBe(H.accrint.prev);
    expect((r.accrued * 10).toFixed(6)).toBe("16.666667");
  });
  test("DURATION 10.9191453 and MDURATION 5.736", () => {
    const a = bondAtYield({ settle: d(H.duration.settle), maturity: d(H.duration.maturity), rate: 0.08, redemption: 100, freq: 2, basis: "actact" }, 0.09);
    const b = bondAtYield({ settle: d(H.mduration.settle), maturity: d(H.mduration.maturity), rate: 0.08, redemption: 100, freq: 2, basis: "actact" }, 0.09);
    if ("error" in a || "error" in b) throw new Error("refused");
    expect(a.macaulay.toFixed(7)).toBe("10.9191453");
    expect(b.modified.toFixed(3)).toBe("5.736");
  });
  test("TBILLEQ 0.09415, TBILLYIELD 0.0914, TBILLPRICE 98.45 at 9%", () => {
    const e = treasuryBill({ settle: d("2008-03-31"), maturity: d("2008-06-01"), discount: 0.0914, yearBasis: "365" });
    const y = treasuryBill({ settle: d("2008-03-31"), maturity: d("2008-06-01"), price: 98.45, yearBasis: "365" });
    const p = treasuryBill({ settle: d("2008-03-31"), maturity: d("2008-06-01"), discount: 0.09, yearBasis: "365" });
    if ("error" in e || "error" in y || "error" in p) throw new Error("refused");
    expect(e.bey.toFixed(5)).toBe("0.09415");
    expect(y.moneyMarket.toFixed(4)).toBe("0.0914");
    expect(p.price.toFixed(2)).toBe("98.45");
  });
});

describe("Treasury bills vs the oracle", () => {
  test.each(named(FX.bills, (b) => `${b.settle} to ${b.maturity}`))("%s", (_n, b) => {
    const r = treasuryBill({
      settle: d(b.settle),
      maturity: d(b.maturity),
      ...(b.price_in !== null ? { price: b.price_in } : { discount: b.discount_in }),
      yearBasis: b.treasury ? "treasury" : "365",
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.days).toBe(b.days);
    expect(r.yearDays).toBe(b.yearDays);
    expect(rel(r.price, b.price)).toBeLessThan(1e-12);
    for (const k of ["discount", "moneyMarket", "bey"] as const) expect(Math.abs(r[k] - b[k])).toBeLessThan(1e-12);
  });
  test("leap-day rule: Feb 29, 2028 is within a year of June 10, 2027, not of March 1, 2028", () => {
    expect(leapDayWithinYear(d("2027-06-10"))).toBe(true);
    expect(leapDayWithinYear(d("2028-03-01"))).toBe(false);
  });
});

describe("bootstrap vs scipy", () => {
  test.each(named(FX.bootstrap, (b) => b.name))("%s", (_n, b) => {
    const ins = b.rows.map((r: number[]) => (b.mode === "par" ? { t: r[0], coupon: r[1] / 100, price: 100 } : { t: r[0], coupon: r[1] / 100, price: r[2] }));
    const c = bootstrapZeroCurve(ins, b.freq);
    if ("error" in c) throw new Error(c.error);
    c.knots.forEach((k, i) => {
      const o = b.knots[i];
      expect(k.t).toBe(o.t);
      expect(Math.abs(k.z - o.z)).toBeLessThan(1e-12);
      expect(rel(k.df, o.df)).toBeLessThan(1e-12);
      expect(Math.abs(k.zPeriodic - o.zPeriodic)).toBeLessThan(1e-12);
      expect(Math.abs(k.fwd - o.fwd)).toBeLessThan(1e-11);
      expect(Math.abs(k.fwdPeriodic - o.fwdPeriodic)).toBeLessThan(1e-11);
    });
  });
  test("par instruments reprice to 100 on the bootstrapped curve", () => {
    const b = FX.bootstrap[0];
    const c = bootstrapZeroCurve(b.rows.map((r: number[]) => ({ t: r[0], coupon: r[1] / 100, price: 100 })), 2);
    if ("error" in c) throw new Error(c.error);
    expect(c.knots[0].zPeriodic).toBeCloseTo(0.043, 12); // a 6-month par bond's zero is its own par yield
  });
});

describe("Nelson–Siegel and Svensson vs scipy", () => {
  test.each(named(FX.ns, (n) => `${n.model} ${n.name}`))("%s", (_n, o) => {
    const fit = fitNelsonSiegel(o.ts, o.ys, o.model);
    if ("error" in fit) throw new Error(fit.error);
    if (o.model === "ns") {
      expect(rel(fit.sse, o.sse)).toBeLessThan(1e-9);
      fit.fitted.forEach((v, i) => expect(Math.abs(v - o.fitted[i])).toBeLessThan(1e-7));
    } else {
      expect(fit.sse).toBeLessThanOrEqual(o.sse * (1 + 1e-6) + 1e-14);
    }
  });
  test("recovers the generating parameters roughly from the noisy generated curve", () => {
    const g = FX.ns.find((n: { name: string; model: string }) => n.name === "generated NS" && n.model === "ns");
    const fit = fitNelsonSiegel(g.ts, g.ys, "ns");
    if ("error" in fit) throw new Error(fit.error);
    expect(fit.beta[0]).toBeCloseTo(5, 0);
    expect(fit.lambda[0]).toBeGreaterThan(1);
    expect(fit.lambda[0]).toBeLessThan(3);
  });
});

describe("schedule rules", () => {
  test("end-of-month: a Feb 28 maturity in a non-leap year keeps every coupon on a month's last day", () => {
    const s = couponSchedule(d("2026-01-10"), d("2027-02-28"), 2);
    if ("error" in s) throw new Error(s.error);
    expect(s.eom).toBe(true);
    expect(iso(s.prev)).toBe("2025-08-31");
    expect(s.dates.map(iso)).toEqual(["2026-02-28", "2026-08-31", "2027-02-28"]);
  });
  test("not end-of-month: a 30th maturity clamps to Feb 28 and returns to the 30th (never steps from the clamp)", () => {
    const s = couponSchedule(d("2026-01-10"), d("2027-08-30"), 2);
    if ("error" in s) throw new Error(s.error);
    expect(s.dates.map(iso)).toEqual(["2026-02-28", "2026-08-30", "2027-02-28", "2027-08-30"]);
  });
  test("settlement on a coupon date accrues nothing and that date is the previous coupon", () => {
    const r = bondAtYield({ settle: d("2026-02-15"), maturity: d("2036-02-15"), rate: 0.05, redemption: 100, freq: 2, basis: "actact" }, 0.05);
    if ("error" in r) throw new Error(r.error);
    expect(r.accrued).toBe(0);
    expect(r.clean).toBeCloseTo(100, 10);
    expect(iso(r.period.schedule.prev)).toBe("2026-02-15");
  });
});

describe("hostile inputs (engine)", () => {
  const base: BondSpec = { settle: d("2026-04-20"), maturity: d("2036-02-15"), rate: 0.05, redemption: 100, freq: 2, basis: "30360us" };
  const err = (x: unknown): string => (x && typeof x === "object" && "error" in x ? (x as { error: string }).error : "");
  test("settlement after (or on) maturity", () => {
    expect(err(bondAtYield({ ...base, settle: d("2037-01-01") }, 0.05))).toMatch(/Maturity date must be after the settlement date/);
    expect(err(bondAtYield({ ...base, settle: base.maturity }, 0.05))).toMatch(/Maturity date/);
  });
  test("frequency 3 refused by name", () => {
    expect(err(bondAtYield({ ...base, freq: 3 }, 0.05))).toMatch(/Coupons per year must be 1, 2, 4 or 12 \(got 3\)/);
    expect(err(couponSchedule(base.settle, base.maturity, 3))).toMatch(/Coupons per year/);
  });
  test("price ≤ 0 and non-finite yields", () => {
    expect(err(yieldFromClean(base, 0))).toMatch(/Clean price must be a positive number/);
    expect(err(yieldFromClean(base, -5))).toMatch(/Clean price/);
    expect(err(bondAtYield(base, Infinity))).toMatch(/Yield must be a finite number/);
    expect(err(bondAtYield(base, NaN))).toMatch(/Yield/);
    expect(err(bondAtYield(base, -2))).toMatch(/at or below −100% per period/);
  });
  test("a price no yield in range reaches is refused naming the range", () => {
    expect(err(yieldFromClean({ ...base, rate: 0, maturity: d("2027-02-15") }, 1e-6))).toMatch(/No yield between −198% and 10,000%/);
  });
  test("zero coupon, zero yield and negative yield price", () => {
    const z = bondAtYield({ ...base, rate: 0 }, 0);
    if ("error" in z) throw new Error(z.error);
    expect(z.clean).toBeCloseTo(100, 12);
    const n = bondAtYield(base, -0.01);
    if ("error" in n) throw new Error(n.error);
    expect(n.clean).toBeGreaterThan(100);
    const back = yieldFromClean(base, n.clean);
    if ("error" in back) throw new Error(back.error);
    expect(Math.abs(back.yield + 0.01)).toBeLessThan(1e-12);
  });
  test("Feb 29 settlement and maturity", () => {
    const r = bondAtYield({ ...base, settle: d("2028-02-29"), maturity: d("2032-02-29") }, 0.04);
    if ("error" in r) throw new Error(r.error);
    expect(r.period.schedule.eom).toBe(true);
    expect(iso(r.period.schedule.prev)).toBe("2028-02-29");
    expect(r.accrued).toBe(0);
  });
  test("over 1,200 coupon periods is refused by name", () => {
    expect(err(couponSchedule(d("1950-01-01"), d("2060-01-01"), 12))).toMatch(/more than 1,200 coupon periods/);
  });
  test("a call date off the coupon schedule is refused as an odd last period", () => {
    expect(err(yieldToWorst(base, 101, d("2029-03-01"), 100))).toMatch(/not one of the bond's coupon dates.*odd last period/);
    expect(err(yieldToWorst(base, 101, d("2026-01-01"), 100))).toMatch(/Call date must be after the settlement date/);
    expect(err(yieldToWorst(base, 101, d("2029-02-15"), 0))).toMatch(/Call price/);
  });
  test("yield to worst picks the call for a premium bond and maturity for a discount bond", () => {
    const prem = yieldToWorst({ ...base, rate: 0.06 }, 104.5, d("2029-02-15"), 101);
    const disc = yieldToWorst({ ...base, rate: 0.03 }, 90, d("2029-02-15"), 101);
    if ("error" in prem || "error" in disc) throw new Error("refused");
    expect(prem.worst).toBe("call");
    expect(disc.worst).toBe("maturity");
    expect(prem.callPeriod.N).toBe(6);
  });
  test("T-bill: beyond a year, at or before settlement, non-positive price", () => {
    expect(err(treasuryBill({ settle: d("2026-01-01"), maturity: d("2027-01-02"), discount: 0.04, yearBasis: "365" }))).toMatch(/more than one year/);
    expect(err(treasuryBill({ settle: d("2026-01-01"), maturity: d("2026-01-01"), discount: 0.04, yearBasis: "365" }))).toMatch(/after the settlement/);
    expect(err(treasuryBill({ settle: d("2026-01-01"), maturity: d("2026-06-01"), price: 0, yearBasis: "365" }))).toMatch(/Price must be a positive/);
    expect(err(treasuryBill({ settle: d("2026-01-01"), maturity: d("2026-12-31"), discount: 1, yearBasis: "365" }))).toMatch(/at or below zero/);
  });
  test("bootstrap and fit refusals", () => {
    expect(err(bootstrapZeroCurve([{ t: 0.75, coupon: 0.04, price: 100 }], 2))).toMatch(/not a whole number of half-years/);
    expect(err(bootstrapZeroCurve([{ t: 1, coupon: 0.04, price: 100 }, { t: 1, coupon: 0.05, price: 100 }], 1))).toMatch(/Two instruments mature at 1 years/);
    expect(err(bootstrapZeroCurve([{ t: 1, coupon: 0.04, price: 100 }], 4))).toMatch(/1 or 2/);
    expect(err(bootstrapZeroCurve([{ t: 1, coupon: 0.04, price: 1e-9 }], 1))).toMatch(/No zero rate between/);
    expect(err(fitNelsonSiegel([1, 2, 3], [4, 4, 4], "ns"))).toMatch(/at least 4 points/);
    expect(err(fitNelsonSiegel([1, 2, 3, 4, 5], [4, 4, 4, 4, 4], "svensson"))).toMatch(/at least 6 points/);
    expect(err(fitNelsonSiegel([1, 1, 1, 1], [4, 4.1, 4.2, 4.3], "ns"))).toMatch(/more distinct maturities/);
    expect(err(fitNelsonSiegel([1, 2, 3, -4], [4, 4.1, 4.2, 4.3], "ns"))).toMatch(/Row 4: maturity/);
  });
  test("30E/360 and 30/360 US bond periods use DSC = E − A", () => {
    const p = bondPeriod({ ...base, basis: "30e360" });
    if ("error" in p) throw new Error(p.error);
    expect(p.A + p.DSC).toBe(p.E);
  });
});
