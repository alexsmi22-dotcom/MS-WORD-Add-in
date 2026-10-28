/**
 * "Fully inclusive" (2026-10-28): the schedule and statement calculators (schedCalcs.ts) say what their result means.
 * Each reading keeps the rules (lib/calcReading.ts), uses only numbers printed in the text or tables, and follows the
 * result: every wording branch is run here.
 */
import { SCHED_CALCS } from "../schedCalcs";
import { calcById, checkedReading } from "./fullFinLibHelpers";

const c = (id: string) => calcById(SCHED_CALCS, id);

describe("loan-schedule", () => {
  test("defaults: the payment and what the extra payments save", () => {
    const r = checkedReading(c("loan-schedule"));
    expect(r).toMatch(/^Each monthly payment is 1,498\.88; the [\d,.]+ of extra principal would save [\d,.]+ of interest and end the loan \d+ months sooner/);
  });
  test("no extra payments: the interest on top of the amount borrowed", () => {
    const r = checkedReading(c("loan-schedule"), { extra: "", lumps: "" });
    expect(r).toBe("Each monthly payment is 1,498.88; over 30 years that is 289,593.37 of interest on top of the 250,000.00 borrowed.");
  });
  test("a balloon, a rate change and a quarterly loan change the wording", () => {
    expect(checkedReading(c("loan-schedule"), { extra: "", lumps: "", balloon: "50000" })).toMatch(/with a balloon of [\d,.]+ at the end/);
    expect(checkedReading(c("loan-schedule"), { extra: "", lumps: "", changes: "13\t8", m: "4" })).toMatch(/^The first quarterly payment is/);
  });
  test("extra payments that do not shorten the loan say so", () => {
    // a balloon loan: the extras reduce the balloon, the loan still ends with the last payment
    const r = checkedReading(c("loan-schedule"), { balloon: "100000", lumps: "", extra: "50" });
    expect(r).toMatch(/would save [\d,.]+ of interest and not shorten the loan/);
  });
});

describe("depr-schedule", () => {
  test("defaults (DDB → SL to zero)", () => {
    expect(checkedReading(c("depr-schedule"))).toBe(
      "Year 1 depreciation is 4,000.00 and 10,000.00 is written off over 5 years; the book value falls from 10,000.00 to 0.00.",
    );
  });
  test("salvage reached, and declining balance that stops short of it", () => {
    expect(checkedReading(c("depr-schedule"), { method: "sl", salvage: "1000" })).toMatch(/to 1,000\.00, the salvage value\.$/);
    expect(checkedReading(c("depr-schedule"), { method: "db", factor: "1.5", salvage: "1000" })).toMatch(/still 680\.70 above the salvage value\.$/);
    expect(checkedReading(c("depr-schedule"), { method: "uop", totalunits: "6000" })).toMatch(/still 1,666\.67 above the salvage value\.$/);
  });
});

describe("macrs", () => {
  test("defaults: first year, the peak year and the recovery period", () => {
    expect(checkedReading(c("macrs"))).toBe(
      "The table deducts 7,145.00 in the first tax year and the most, 12,245.00, in year 2, recovering the whole 50,000.00 basis over 8 tax years (7-year property).",
    );
  });
  test("straight line: tied peak years are not called a single peak", () => {
    expect(checkedReading(c("macrs"), { system: "sl" })).toMatch(/5,000\.00 a year at its peak, in years 2 to 10/);
  });
  test("the reading follows the basis and class", () => {
    expect(checkedReading(c("macrs"), { basis: "80000", class: "3" })).toMatch(/80,000\.00 basis over 4 tax years \(3-year property\)/);
  });
});

describe("fin-ratios", () => {
  test("defaults: return on equity against the prior year, liquidity and leverage", () => {
    expect(checkedReading(c("fin-ratios"))).toBe(
      "Return on equity is 22.50% on a net margin of 9.38%, up from 17.86% the prior year. Current assets are 2.00× current liabilities (enough to cover them) and total liabilities are 1.00× shareholders’ equity.",
    );
  });
  test("average balances do not compare with the prior year's year-end ratio", () => {
    expect(checkedReading(c("fin-ratios"), { balances: "average" })).not.toMatch(/prior year/);
  });
  test("a falling return and current assets short of current liabilities", () => {
    const stmt = c("fin-ratios").fields.find((f) => f.key === "stmt")!.default.replace("Net income\t112,500\t75,000", "Net income\t30,000\t75,000").replace("Total current liabilities\t200,000", "Total current liabilities\t500,000");
    const r = checkedReading(c("fin-ratios"), { stmt });
    expect(r).toMatch(/down from 17\.86% the prior year/);
    expect(r).toMatch(/not enough to cover them/);
  });
  test("only one ratio computable: the reading still says it", () => {
    expect(checkedReading(c("fin-ratios"), { stmt: "Total current assets\t100\nTotal current liabilities\t200" })).toBe(
      "Current assets are 0.50× current liabilities (not enough to cover them).",
    );
  });
});

describe("fin-common-size", () => {
  test("defaults: shares of revenue and revenue growth", () => {
    expect(checkedReading(c("fin-common-size"))).toBe("Net income is 9.38% of revenue and cost of goods sold takes 60.00%; revenue grew 14.29% on the prior year.");
  });
  test("a balance sheet alone, and a fall in revenue", () => {
    expect(checkedReading(c("fin-common-size"), { stmt: "Total assets\t1000\nTotal liabilities\t400\nShareholders’ equity\t600" })).toBe(
      "Total liabilities are 40.00% of total assets and shareholders’ equity is 60.00%.",
    );
    expect(checkedReading(c("fin-common-size"), { stmt: "Line item\tThis year\tPrior year\nNet sales\t900\t1,000\nNet income\t90\t100" })).toMatch(/revenue fell 10\.00% on the prior year/);
  });
});

describe("altman-z", () => {
  test("each zone has its own wording", () => {
    expect(checkedReading(c("altman-z"))).toMatch(/^Z = 3\.6040 puts the company in the safe zone, above the 2\.99 cut-off/);
    expect(checkedReading(c("altman-z"), { variant: "zprime" })).toMatch(/grey zone, between the 1\.23 and 2\.90 cut-offs/);
    const distress = c("altman-z").fields.find((f) => f.key === "stmt")!.default.replace("Retained earnings\t350,000", "Retained earnings\t−400,000").replace("Operating income\t180,000", "Operating income\t−50,000");
    expect(checkedReading(c("altman-z"), { stmt: distress })).toMatch(/distress zone, below the 1\.81 cut-off/);
  });
});

describe("cvp-breakeven", () => {
  test("above, below and exactly at break-even, and no sales", () => {
    expect(checkedReading(c("cvp-breakeven"))).toBe(
      "Break-even is 2,000.00 units (100,000.00 of revenue); at 3,000 units the business earns 20,000.00 of operating income, and sales could fall 33.33% before it makes a loss.",
    );
    expect(checkedReading(c("cvp-breakeven"), { units: "1000" })).toMatch(/below break-even, with an operating result of −20,000\.00, and needs 1,000\.00 more units/);
    expect(checkedReading(c("cvp-breakeven"), { units: "2000" })).toMatch(/the business breaks even, with an operating income of 0\.00/);
    expect(checkedReading(c("cvp-breakeven"), { units: "0" })).toMatch(/with no sales entered, the operating loss is the fixed costs of 40,000\.00/);
  });
});

test("every schedule calculator's reading changes with its input", () => {
  const changed: Record<string, Record<string, string>> = {
    "loan-schedule": { p: "300000" },
    "depr-schedule": { cost: "20000" },
    macrs: { basis: "60000" },
    "fin-ratios": { balances: "average" },
    "fin-common-size": { stmt: "Net sales\t1,000\nNet income\t50" },
    "altman-z": { variant: "zdouble" },
    "cvp-breakeven": { price: "60" },
  };
  for (const calc of SCHED_CALCS) expect(checkedReading(calc, changed[calc.id])).not.toBe(checkedReading(calc));
});

test("fin-ratios: a current ratio that prints 1.00× is about equal to current liabilities, not short of them", () => {
  const r = checkedReading(c("fin-ratios"), { stmt: "Total current assets\t99,950\nTotal current liabilities\t100,000" });
  expect(r).toBe("Current assets are 1.00× current liabilities (about equal to them).");
});
