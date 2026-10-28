/**
 * "Fully inclusive" (2026-10-28): the plain-language readings of the cost–benefit, currency-parity and forensic /
 * actuarial calculators (cbaCalcs.ts, forensicCalcs.ts via forensicReports.ts). Every reading keeps the rules
 * (readingProblems), its numbers come from the text or tables, it follows the input, and each wording branch is hit.
 */
import { CBA_CALCS, cipReading } from "../cbaCalcs";
import { FORENSIC_CALCS } from "../forensicCalcs";
import { calcById, checkedReading, runCalc, asObj } from "./fullFinLibHelpers";

const ALL = [...CBA_CALCS, ...FORENSIC_CALCS];
const cba = (id: string) => calcById(CBA_CALCS, id);
const fo = (id: string) => calcById(FORENSIC_CALCS, id);

describe("every calculator: defaults carry a checked reading that changes with the input", () => {
  const change: Record<string, Record<string, string>> = {
    "cba-scenarios": { rate: "7" },
    "cba-pigou": { e0: "10" },
    "fx-cip": { fwd: "1.26" },
    "fx-uip": { st: "1.30" },
    "fx-ppp": { spot: "1.10" },
    "dmg-lost-earnings-lpe": { base: "80,000" },
    "act-annuity": { age: "70" },
    "act-retire": { withdraw: "90,000" },
    "act-swr-mc": { withdraw: "60,000" },
  };
  test.each(ALL.map((c) => [c.id, c] as const))("%s", (id, c) => {
    const r0 = checkedReading(c);
    expect(change[id]).toBeDefined();
    const r1 = checkedReading(c, change[id]);
    expect(r1).not.toBe(r0);
  });
});

describe("cba-scenarios", () => {
  test("several scenarios: count passing, best and worst", () => {
    const r = checkedReading(cba("cba-scenarios"));
    expect(r).toMatch(/2 of 3 scenarios pass/);
    expect(r).toMatch(/High does best with an NPV of 178\.85 and Low worst at −351\.13/);
    expect(checkedReading(cba("cba-scenarios"), { rate: "5.08" })).toMatch(/1 of 3 scenarios passes/);
  });
  test("equal scenarios: one NPV, not a best and a worst", () => {
    const eq = "Year\tA benefits\tA costs\tB benefits\tB costs\n2026\t100\t100\t100\t100";
    expect(checkedReading(cba("cba-scenarios"), { data: eq })).toMatch(/Every scenario has the same NPV, 0\.00\.$/);
  });
  test("none pass at a high rate; all pass at a low one", () => {
    expect(checkedReading(cba("cba-scenarios"), { rate: "12" })).toMatch(/none of the 3 scenarios passes/);
    expect(checkedReading(cba("cba-scenarios"), { rate: "−8" })).toMatch(/all 3 scenarios pass/);
  });
  test("one scenario: passes, fails", () => {
    const one = "Year\tBenefits\tCosts\n2026\t0\t1000\n2027\t600\t0\n2028\t600\t0";
    expect(checkedReading(cba("cba-scenarios"), { data: one, rate: "4" })).toMatch(/net present value is 131\.66: benefits outweigh costs \(benefit–cost ratio 1\.132\), so on these numbers the project passes/);
    expect(checkedReading(cba("cba-scenarios"), { data: one, rate: "20" })).toMatch(/costs outweigh benefits .* fails/);
  });
  test("one scenario breaking even reads as break-even", () => {
    const even = "Year\tBenefits\tCosts\n2026\t0\t1000\n2027\t1000\t0";
    expect(checkedReading(cba("cba-scenarios"), { data: even, rate: "0" })).toMatch(/is 0\.00: benefits and costs balance exactly .* just breaks even on/);
  });
});

describe("cba-pigou", () => {
  test("over-production with a tax", () => {
    expect(checkedReading(cba("cba-pigou"))).toMatch(/over-produces \(60\.0000 units against the efficient 49\.4118\) and wastes 95\.29 .* tax of 15\.8824 per unit/);
  });
  test("an external benefit: under-production with a subsidy", () => {
    expect(checkedReading(cba("cba-pigou"), { e0: "−6", e1: "0" })).toMatch(/under-produces .* subsidy of 6\.0000 per unit/);
  });
  test("no externality: already efficient", () => {
    expect(checkedReading(cba("cba-pigou"), { e0: "0", e1: "0" })).toMatch(/already produces the efficient 60\.0000 units/);
  });
  test("corner: the efficient output is zero", () => {
    expect(checkedReading(cba("cba-pigou"), { e0: "95" })).toMatch(/efficient output is zero.* at least 90\.0000 per unit/);
  });
});

describe("fx-cip", () => {
  test("dear forward: the rules' register", () => {
    expect(checkedReading(cba("fx-cip"))).toBe(
      "The quoted forward 1.265000 is 20.20 basis points above parity (1.262450), so borrowing domestic, converting and selling forward locks in about 2,070.89 per 1,000,000.00 borrowed, before trading costs.",
    );
  });
  test("cheap forward", () => {
    expect(checkedReading(cba("fx-cip"), { fwd: "1.26" })).toMatch(/is 19\.41 basis points below parity \(1\.262450\), so borrowing foreign/);
  });
  test("a deviation under 0.005 basis points is not printed as 0.00 beside a profit", () => {
    // fix-fin R2 #11: a quote that PRINTS as the parity forward (1.26245 against 1.262450) is parity, not arbitrage.
    expect(checkedReading(cba("fx-cip"), { fwd: "1.26245" })).toMatch(/matches the parity forward 1\.262450 to the 6 decimals shown/);
    // Printed apart in the 6th decimal, yet under 0.005 basis points: described, not printed as 0.00.
    const res = { F: 1.2624504, growD: 1, growF: 1.25 / 1.2624504, tauD: 0.5, tauF: 0.5 };
    const r = cipReading(1.25, res, 182, 1.2624506, 1_000_000, null);
    expect(r).toMatch(/is a fraction of a basis point above parity/);
    expect(r).not.toMatch(/0\.00 basis/);
  });
  test("at parity", () => {
    expect(checkedReading(cba("fx-cip"), { id: "3", fwd: "1.25" })).toMatch(/matches the parity forward 1\.250000 to the 6 decimals shown: covered interest parity holds/);
  });
  test("no quote: the forward above, below or at spot", () => {
    expect(checkedReading(cba("fx-cip"), { fwd: "" })).toMatch(/182-day forward rate .* is 1\.262450, above the spot 1\.250000/);
    expect(checkedReading(cba("fx-cip"), { fwd: "", id: "1" })).toMatch(/below the spot 1\.250000/);
    expect(checkedReading(cba("fx-cip"), { fwd: "", id: "3" })).toMatch(/equal to the spot/);
  });
  test("a currency code and a huge notional stay within the rules", () => {
    const r = checkedReading(cba("fx-cip"), { base: "EUR", quote: "USD", notional: "900,000,000,000,000" });
    expect(r).toMatch(/\$/);
  });
});

describe("fx-uip", () => {
  test("weakens, and a realized spot behind", () => {
    expect(checkedReading(cba("fx-uip"))).toMatch(/is expected to weaken by 1\.9417% over 1 year, to 1\.274272 .* 2\.6895% behind\.$/);
  });
  test("strengthens, carry paid", () => {
    expect(checkedReading(cba("fx-uip"), { id: "1", st: "1.30", years: "2" })).toMatch(/expected to strengthen by .* over 2 years.*ahead \(the carry trade paid\)/);
  });
  test("no realized spot: a benchmark; equal rates: no expected change", () => {
    expect(checkedReading(cba("fx-uip"), { st: "" })).toMatch(/parity benchmark, not a forecast\.$/);
    expect(checkedReading(cba("fx-uip"), { st: "", id: "3" })).toMatch(/no expected change in the exchange rate over 1 year \(1\.250000/);
  });
  test("a realized spot exactly at the expectation comes out even", () => {
    expect(checkedReading(cba("fx-uip"), { id: "3", st: "1.25" })).toMatch(/came out even/);
  });
});

describe("fx-ppp", () => {
  test("absolute: over, under, at parity and no spot", () => {
    expect(checkedReading(cba("fx-ppp"))).toMatch(/overvalued by 9\.09% .* 1\.145833: the basket costs more abroad/);
    expect(checkedReading(cba("fx-ppp"), { spot: "1.10" })).toMatch(/undervalued by .* costs less abroad/);
    expect(checkedReading(cba("fx-ppp"), { pd: "5", pf: "4", spot: "1.25" })).toMatch(/is at the purchasing-power parity rate 1\.250000/);
    expect(checkedReading(cba("fx-ppp"), { spot: "" })).toMatch(/puts the exchange rate at 1\.145833/);
  });
  test("relative: rising, falling, unchanged", () => {
    expect(checkedReading(cba("fx-ppp"), { mode: "relative" })).toMatch(/rising .* over 5 years, from 1\.250000 to .*domestic currency weakens/);
    expect(checkedReading(cba("fx-ppp"), { mode: "relative", infd: "1" })).toMatch(/falling .*strengthens/);
    expect(checkedReading(cba("fx-ppp"), { mode: "relative", infd: "2" })).toMatch(/leaves the exchange rate at 1\.250000 over 5 years/);
  });
});

describe("forensic and actuarial", () => {
  test("lost earnings: living plaintiff, wrongful death, all future", () => {
    expect(checkedReading(fo("dmg-lost-earnings-lpe"))).toMatch(/^Estimated lost earnings and household services come to \$885,891\.18 at the trial date: \$162,056\.00 already lost/);
    expect(checkedReading(fo("dmg-lost-earnings-lpe"), { survival: "injury", consumption: "30" })).toMatch(/^Estimated economic losses from the death/);
    expect(checkedReading(fo("dmg-lost-earnings-lpe"), { trial: "2023-06-30" })).toMatch(/all of it future losses in present value/);
    expect(checkedReading(fo("dmg-lost-earnings-lpe"), { method: "wle", dmode: "ndr" })).not.toBe(checkedReading(fo("dmg-lost-earnings-lpe")));
  });
  test("annuity: with a payment and factors only", () => {
    expect(checkedReading(fo("act-annuity"))).toMatch(/12,000\.00 a year from age 65.* worth 161,450\.17 today at 4% interest; life expectancy at 65 is 19\.66 years/);
    expect(checkedReading(fo("act-annuity"), { payment: "0" })).toMatch(/1 a year for life from age 65, starting now, is worth 13\.4542 today/);
  });
  test("retirement: lasts, runs out, no drawdown", () => {
    expect(checkedReading(fo("act-retire"))).toMatch(/last to age 95 with 103,941\.74 left\. About 60,639\.94 a year/);
    expect(checkedReading(fo("act-retire"), { withdraw: "90,000" })).toMatch(/the money runs out at age \d+, before age 95: .* not 90,000\.00, would last to age 95\./);
    expect(checkedReading(fo("act-retire"), { retire: "95" })).toMatch(/last to age 95 with .* left\.$/);
    // Nothing saved: no "about 0.00 a year would last" clause.
    expect(checkedReading(fo("act-retire"), { age: "67", retire: "67", balance: "0" })).toMatch(/runs out at age 67, before age 95: savings reach 0\.00 at age 67 \(0\.00 in today's money\)\.$/);
  });
  test("safe withdrawal: with and without a life table, one year", () => {
    expect(checkedReading(fo("act-swr-mc"))).toMatch(/about 23\.4% of 20,000 simulated return paths; .* outliving the money is about 8\.4%\./);
    expect(checkedReading(fo("act-swr-mc"), { table: "none" })).toMatch(/rests on the return assumptions entered\.$/);
    expect(checkedReading(fo("act-swr-mc"), { table: "none", years: "1" })).toMatch(/within 1 year in none of 20,000 simulated return paths, so the chance is below about 1 in 20,000/);
  });
  test("a refusal carries no reading", () => {
    const o = asObj(runCalc(fo("act-retire"), { retire: "30" }));
    expect(o.ok).toBe(false);
    expect(o.reading).toBeUndefined();
    const p = asObj(runCalc(cba("fx-cip"), { spot: "0" }));
    expect(p.ok).toBe(false);
    expect(p.reading).toBeUndefined();
  });
});
