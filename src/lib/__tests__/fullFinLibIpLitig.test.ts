/**
 * "Fully inclusive" (2026-10-28): the plain-language readings of the IP-valuation (ipValuationCalcs.ts) and
 * litigation-damages (litigCalcs.ts) calculators. Each default carries a reading that keeps the rules
 * (lib/calcReading.ts), every number in it is traceable to the text or tables, it changes with the input, and each
 * wording branch is reached.
 */
import { IPVAL_CALCS } from "../ipValuationCalcs";
import { LITIG_CALCS } from "../litigCalcs";
import { asObj, calcById, checkedReading, runCalc } from "./fullFinLibHelpers";
import { lookbackReading, aggregateReading, outOfPocketReading } from "../securitiesDamages";
import { readingProblems } from "../calcReading";
import { antitrustReading, type OverchargeEstimate } from "../antitrustDamages";

const ip = (id: string) => calcById(IPVAL_CALCS, id);
const lit = (id: string) => calcById(LITIG_CALCS, id);

describe.each([...IPVAL_CALCS, ...LITIG_CALCS].map((c) => [c.id, c] as const))("%s", (_id, c) => {
  test("its defaults carry a reading that keeps the rules, every number traceable", () => {
    expect(checkedReading(c).length).toBeGreaterThan(40);
  });
});

describe("IP valuation readings follow the result", () => {
  test("ipv-rfr: the tax amortization clause only with a TAB; the value moves with the royalty rate", () => {
    const d = checkedReading(ip("ipv-rfr"));
    expect(d).toMatch(/^On these inputs the patent is worth about [\d,.]+, including [\d,.]+ of tax amortization benefit\./);
    const noTab = checkedReading(ip("ipv-rfr"), { tab: "no" });
    expect(noTab).not.toMatch(/amortization/);
    expect(checkedReading(ip("ipv-rfr"), { royalty: "6" })).not.toBe(d);
  });

  test("ipv-income: a negative value is said to be negative, not 'worth'", () => {
    const d = checkedReading(ip("ipv-income"));
    expect(d).toMatch(/worth about/);
    const flows = ["2027 100000 300000", "2028 110000 300000", "2029 120000 300000", "2030 120000 300000", "2031 120000 300000", "2032 120000 300000"].join("\n");
    const neg = checkedReading(ip("ipv-income"), { flows });
    expect(neg).toMatch(/^On these inputs the value comes out negative, −[\d,.]+:/);
    expect(neg).not.toMatch(/worth/);
  });

  test("ipv-mc: none, some, and every outcome losing money", () => {
    expect(checkedReading(ip("ipv-mc"))).toMatch(/averages about 114,100, and the middle of the outcomes runs from about −157,500 at P10 to 421,700 at P90\. On these input ranges [\d,]+ of the 50,000 simulated outcomes \(about [\d.]+%\) lose money\.$/);
    const fixed = { ratedist: "fixed", rate: "4", lifedist: "fixed", life: "1", revdist: "fixed", rev: "1000000", discdist: "fixed", disc: "0", cost: "30000", samples: "1000" };
    expect(checkedReading(ip("ipv-mc"), fixed)).toMatch(/NPV is 1,600\.00 in every simulated outcome: with these inputs nothing varies\./); // fix round 2 MINOR 4: exact, no "about"
    expect(checkedReading(ip("ipv-mc"), { cost: "0", samples: "2000" })).toMatch(/none of the 2,000 simulated outcomes loses money\.$/);
    expect(checkedReading(ip("ipv-mc"), { cost: "900000000", samples: "2000" })).toMatch(/every one of the 2,000 simulated outcomes loses money\.$/);
  });

  test("ipv-apportion: the royalty follows the shares and the base", () => {
    const d = checkedReading(ip("ipv-apportion"));
    expect(d).toContain("$432,000.00");
    expect(d).toContain("0.36%");
    const u = checkedReading(ip("ipv-apportion"), { basis: "unit", units: "1000", price: "50", ssu: "100", feature: "100", patent: "100", rate: "10" });
    expect(u).toContain("$5,000.00");
    expect(u).toContain("10.00%");
  });

  test("ipv-emvr-ssppu: different bases, and equal bases", () => {
    const d = checkedReading(ip("ipv-emvr-ssppu"));
    expect(d).toMatch(/\$540,000\.00 against \$3,600,000\.00 on the entire product, \$3,060,000\.00 less/);
    expect(d).toContain("0.45%");
    const eq = checkedReading(ip("ipv-emvr-ssppu"), { ssppu: "120000000" });
    expect(eq).toMatch(/^At 3\.00% both bases give a royalty of \$3,600,000\.00 to the cent/);
    // Bases 1 cent apart: the royalties are the same to the cent, so no "$0.00 less".
    expect(checkedReading(ip("ipv-emvr-ssppu"), { ssppu: "119999999.99" })).toMatch(/^At 3\.00% both bases give a royalty of \$3,600,000\.00 to the cent/);
  });

  test("ipv-comparable: lump sum to rate, and rate to lump sum", () => {
    expect(checkedReading(ip("ipv-comparable"))).toMatch(/^The \$2,500,000\.00 lump sum is worth about the same as a running royalty of 2\.6718%/);
    const r2l = checkedReading(ip("ipv-comparable"), { direction: "rate2lump" });
    expect(r2l).toMatch(/^A 2\.50% running royalty on the forecast base is worth about \$[\d,.]+ paid up front/);
  });

  test("ipv-nash: the split follows the share", () => {
    const d = checkedReading(ip("ipv-nash"));
    expect(d).toContain("$1,250,000.00 and the licensee keeps $1,250,000.00");
    const s40 = checkedReading(ip("ipv-nash"), { share: "40" });
    expect(s40).toContain("is $1,000,000.00 and the licensee keeps $1,500,000.00");
    expect(s40).toContain("40.00% patentee share");
  });
});

describe("litigation readings follow the result", () => {
  test("dmg-sec-ribbon: dollar and percentage ribbons", () => {
    const d = checkedReading(lit("dmg-sec-ribbon"));
    expect(d).toContain("$5.9312 of inflation per share");
    expect(d).toContain("2 corrective disclosures");
    const pct = checkedReading(lit("dmg-sec-ribbon"), { mode: "ar-pct" });
    expect(pct).toMatch(/about [\d.]+% of the share price \(\$[\d.]+ per share\)/);
    const one = checkedReading(lit("dmg-sec-ribbon"), {
      mode: "dollar",
      disclosures: ["Disclosure date\tInflation removed", "2025-03-31\t3.00"].join("\n"),
    });
    expect(one).toContain("about $3.00 of inflation per share");
    expect(one).toContain("1 corrective disclosure.");
  });

  test("dmg-sec-oop: a loss, LIFO changes it, and no class-period purchases", () => {
    const d = checkedReading(lit("dmg-sec-oop"));
    expect(d).toMatch(/^On these trades the estimated out-of-pocket loss is about \$9,929\.37 on 1,900 shares/);
    const blotter = ["Date\tSide\tShares\tPrice", "2025-02-20\tBuy\t300\t40.10", "2025-04-02\tSell\t100\t33.75"].join("\n");
    expect(checkedReading(lit("dmg-sec-oop"), { blotter })).toMatch(/^None of these shares were bought in the class period/);
    expect(outOfPocketReading(-12.5, 10)).toBe("On these inputs the 10 shares bought in the class period show no net out-of-pocket loss (−$12.50).");
    expect(outOfPocketReading(12.5, 1)).toContain("on 1 share bought");
  });

  test("dmg-pslra: within the cap, cut by the cap, capped at zero, and no purchase price", () => {
    expect(checkedReading(lit("dmg-pslra"))).toMatch(/^The \$5\.9312 loss per share is within the PSLRA 90-day lookback cap of \$6\.6053/);
    const cut = checkedReading(lit("dmg-pslra"), { loss: "8" });
    expect(cut).toMatch(/caps damages at \$6\.6053 per share .* so the \$8\.00 loss per share is cut to \$6\.6053\.$/);
    const zero = checkedReading(lit("dmg-pslra"), { purchase: "30" });
    expect(zero).toMatch(/^The purchase price \$30\.00 is below the \$34\.5947 mean trading price, so .* capped at zero\.$/);
    const none = checkedReading(lit("dmg-pslra"), { purchase: "", loss: "" });
    expect(none).toMatch(/^The mean trading price that sets the PSLRA cap is \$34\.5947 per share/);
    const capOnly = checkedReading(lit("dmg-pslra"), { loss: "" });
    expect(capOnly).toMatch(/^Under the PSLRA 90-day lookback, damages cannot exceed \$6\.6053 per share/);
    // At the cap exactly: the cap does not reduce the loss.
    expect(lookbackReading(30, 35, 5)).toMatch(/equals the PSLRA 90-day lookback cap of \$5\.00 per share .*, so the cap does not reduce it\.$/);
  });

  test("dmg-sec-aggregate: both models, and each alone", () => {
    expect(checkedReading(lit("dmg-sec-aggregate"))).toMatch(/one-trader model and \$[\d,.]+ under the two-trader model\./);
    expect(checkedReading(lit("dmg-sec-aggregate"), { model: "one" })).toMatch(/at about \$[\d,.]+ under the one-trader model\./);
    expect(checkedReading(lit("dmg-sec-aggregate"), { model: "two" })).toMatch(/at about \$[\d,.]+ under the two-trader model\./);
    expect(readingProblems(aggregateReading("$10,000,000,000,000.00", "$10,000,000,000,000.00"))).toEqual([]);
  });

  test("dmg-antitrust: significant, not significant, no overcharge, forecast alone", () => {
    const d = checkedReading(lit("dmg-antitrust"));
    expect(d).toMatch(/^The regression estimates an overcharge of 9\.19% of the but-for price \(damages about \$468,342\.04\) by the dummy-variable method and 10\.49%/);
    expect(d).toMatch(/The dummy-variable estimate is statistically significant at the 5% level \(p \S+\s?0\.001\)\.$/);
    expect(checkedReading(lit("dmg-antitrust"), { method: "forecast" })).toMatch(/The forecast method gives no test/);
    const rows = (during: number[]): string =>
      [
        "Month\tPeriod\tPrice",
        ...[100, 102, 98, 101, 99, 100].map((p, i) => `b${i + 1}\tbefore\t${p}`),
        ...during.map((p, i) => `d${i + 1}\tduring\t${p}`),
      ].join("\n");
    const ns = checkedReading(lit("dmg-antitrust"), { data: rows([100.5, 99, 102, 101, 98, 101.5]), controls: "", method: "dummy" });
    expect(ns).toMatch(/The data do not clearly separate the overcharge from zero \(p = 0\.\d+\), so it could be chance\.$/);
    const neg = checkedReading(lit("dmg-antitrust"), { data: rows([95, 96, 94, 95, 97, 93]), controls: "", method: "dummy" });
    expect(neg).toMatch(/^These data give no positive overcharge estimate: .*−[\d.]+% by the dummy-variable method\), so the estimate supports no positive damages\.$/);
  });

  test("every reading is absent on a refusal", () => {
    const o = asObj(runCalc(ip("ipv-nash"), { method: "rule25" }));
    expect(o.ok).toBe(false);
    expect(o.reading).toBeUndefined();
  });
});

test("dmg-antitrust: methods that disagree in sign are each worded by their own sign (never a negative overcharge)", () => {
  const est = (method: "dummy" | "forecast", pct: number, p?: number): OverchargeEstimate =>
    ({ method, pctOfButFor: pct, perUnit: 0, shareOfActual: 0, butFor: [], during: [], fit: {} as OverchargeEstimate["fit"], ...(p !== undefined ? { dummy: { p } as OverchargeEstimate["dummy"] } : {}) }) as OverchargeEstimate;
  const r = antitrustReading([est("dummy", 0.0412, 0.2), est("forecast", -0.0137)], ["$120,000.00", "−$40,000.00"]);
  expect(r).toMatch(/^The dummy-variable method estimates an overcharge of 4\.12% of the but-for price \(damages about \$120,000\.00\), but the forecast method gives no positive overcharge estimate \(−1\.37%\)\./);
  expect(r).not.toMatch(/overcharge of −/);
  expect(readingProblems(r)).toEqual([]);
  const r2 = antitrustReading([est("dummy", -0.02, 0.01), est("forecast", 0.03)], ["−$1.00", "$2.00"]);
  expect(r2).toMatch(/^The dummy-variable method gives no positive overcharge estimate \(−2\.00%\), but the forecast method estimates an overcharge of 3\.00%/);
});
