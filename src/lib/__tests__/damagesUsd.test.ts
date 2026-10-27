/**
 * v2.201.0: "$" on the damages calculators, and the refusal of every other currency that a pasted table names —
 * pinned to the review round's repros (a code or a prefixed dollar in a column title or a trailing text column was
 * skipped silently and the amounts printed as US dollars).
 */
import { foreignCurrencyRefusal, usd } from "../damagesUsd";
import { damagesFigure, parsePeriodTable } from "../patentDamages";
import { parseRateTable, parseTranches, postjudgmentReport } from "../damagesInterest";

const period = (text: string) => parsePeriodTable(text, ["revenue"], 1);
const err = (r: object): string => ("error" in r ? String((r as { error: string }).error) : "");

describe("usd()", () => {
  test("the minus goes before the sign; the non-finite sentinel is kept for the insert gates", () => {
    expect(usd("1,234.50")).toBe("$1,234.50");
    expect(usd("−1,234.50")).toBe("−$1,234.50");
    expect(usd("—")).toBe("—");
  });
});

describe("a currency other than the US dollar is refused by name", () => {
  test.each([
    ["Period\tRevenue (C$)\n2021\t1,000,000", "C$"],
    ["Period\tRevenue (EUR)\n2021\t1,000,000", "EUR"],
    ["Year Revenue EUR\n2021 1000000", "EUR"],
    ["2021\tHK$1,000", "HK$"],
    ["2021\tR$1,000", "R$"],
    ["2021\t€1,000", "€"],
  ])("royalty table %j names %s", (text, named) => {
    const e = err(period(text));
    expect(e).toContain(`“${named}”`);
    expect(e).toContain("work in US dollars");
  });

  test.each([
    ["2024-01-05\t1,000,000\tCAD", "CAD"],
    ["Date\tAmount (EUR)\n2024-01-05\t1,000,000", "EUR"],
    ["2024-01-05\t1,000,000\tC$", "C$"],
  ])("damages list %j names %s", (text, named) => {
    const r = parseTranches(text, false);
    expect(r.ok).toBe(false);
    expect(err(r)).toContain(`“${named}”`);
  });

  test("¢ and full-width ＄ get their own advice", () => {
    expect(foreignCurrencyRefusal("2021\t50¢", "The table")).toContain("50¢ is 0.50");
    expect(foreignCurrencyRefusal("2021\t＄500", "The table")).toContain("ordinary $ sign");
  });
});

describe("the US dollar in every spelling still reads", () => {
  test("$, US$, a USD column title, “Totals (USD)” and capitalised words that are also codes", () => {
    for (const text of ["2021\t$1,000", "2021\tUS$1,000", "Period\tRevenue (USD)\n2021\t1,000", "ALL PERIODS\tREVENUE\n2021\t1,000", "TOP SELLER 2021\t1,000"]) {
      const r = period(text);
      expect(err(r)).toBe("");
      if (!("error" in r)) expect(r.rows.map((x) => x.values[0])).toEqual([1000]);
    }
    const t = parseTranches("2024-01-05\tUS$1,000\n2024-02-05\t$500", false);
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.value.map((x) => x.amount)).toEqual([1000, 500]);
  });
});

// The settled case table (narrow review round): a code is a currency only where a currency goes — beside a number,
// alone in brackets, after "in", a whole cell, the last word of a title line. Elsewhere it is a word in a label.
describe("case table: what is and is not a foreign currency", () => {
  const ACCEPT = [
    "2021 1,000,000 per MDL order", "MDL No. 2741", "Year\tSSP\n2021\t1,000,000", "IRR", "2021\t$XXX", "(XXX)",
    "SVC revenue", "UNITS SHP", "AED units", "NAD+ product", "NOK handsets", "CAD SOFTWARE", "NET$", "EST$", "ASP$",
    "Period | Revenue ($) | Units", "FY2023", "Q1 2024", "MAR 2023", "SKU ABC-100", "IBM", "USA", "YTD", "Totals (USD)",
    "pounds shipped", "amounts in USD", "US$1,000", "USD$1,000", "U.S.$1,000", "us$1,000",
  ];
  const REFUSE: [string, string][] = [
    ["Year\tRevenue (RMB)", "RMB"], ["Revenue (NTD)", "NTD"], ["Revenue (euros)", "euros"], ["1,000,000\teuros", "euros"],
    ["Revenue (EURm)", "EURm"], ["Can$1,000", "Can$"], ["Aus$ revenue", "Aus$"], ["Mex$500", "Mex$"], ["EUR 1,000", "EUR"],
    ["1000CAD", "CAD"], ["amounts in GBP", "GBP"], ["Date\tAmount\tEUR", "EUR"], ["Year Revenue CHF", "CHF"],
    ["2021\tC$1,000", "C$"], ["sales in yen", "yen"],
  ];
  test.each(ACCEPT)("%j is not a foreign currency", (text) => {
    expect(foreignCurrencyRefusal(text, "The table")).toBeUndefined();
  });
  test.each(REFUSE)("%j is refused naming %s", (text, named) => {
    expect(foreignCurrencyRefusal(text, "The table")).toContain(`“${named}”`);
  });
  test("USD written before or after the number reads as dollars", () => {
    for (const cell of ["USD 1,000,000", "1,000,000 USD", "U.S.$1,000,000", "us$1,000,000", "USD$1,000,000"]) {
      const r = period(`2021\t${cell}`);
      expect(err(r)).toBe("");
      if (!("error" in r)) expect(r.rows[0].values[0]).toBe(1000000);
    }
    const neg = parseTranches("2024-01-05\t−$5", false);
    expect(neg.ok).toBe(false);
    expect(err(neg)).toContain("negative");
  });
  test("a 10,000-line paste is checked fast", () => {
    const text = Array.from({ length: 10000 }, (_, i) => `${2000 + (i % 30)}-01-01\t$${(i * 37) % 100000}.25\tSKU ABC-${i}`).join("\n");
    const t0 = Date.now();
    expect(foreignCurrencyRefusal(text, "The table")).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("review round: the smaller fixes", () => {
  test("a currency sign in the rate table is refused, never read as a rate", () => {
    const r = parseRateTable("2019-01-01\t$5");
    expect(r.ok).toBe(false);
    expect(err(r)).toContain("annual rates in percent");
  });

  test("the February 29 note prints only for a February 29 judgment", () => {
    const base = { amount: 100000, ratePct: 5, payment: "2026-06-30", dayCount: "act365" };
    const march = postjudgmentReport({ ...base, judgment: "2023-03-15" });
    expect(march.ok).toBe(true);
    expect(march.text).not.toContain("February 29");
    const leap = postjudgmentReport({ ...base, judgment: "2024-02-29" });
    expect(leap.ok).toBe(true);
    expect(leap.text).toContain("February 29 judgment");
  });

  test("the stacked-column damages figure carries the unit in its title", () => {
    const svg = damagesFigure(["2021", "2022"], [{ name: "Royalty", values: [100, 200] }], "Reasonable royalty by period");
    expect(svg).toContain("Reasonable royalty by period ($)");
  });
});
