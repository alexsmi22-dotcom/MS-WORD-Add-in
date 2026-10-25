// Litigation damages, E1a: prejudgment and post-judgment interest.
//
// Every money figure below is pinned from an INDEPENDENT Python oracle
// (C:\Users\AlexanderSmith\jurislab-relE\oracle_e1a_interest.py): a naive day-by-day loop with datetime.date and
// Decimal (no prefix sums, daily compounding multiplied day by day), rounded half-up to the cent. The engine uses
// prefix sums, double-double prefix products for daily compounding, and integer civil days, so agreement to the cent
// checks the shortcuts (the 10¹² cap cases are in damagesE1fix.test.ts).
import {
  addMonthsClamped,
  civilDay,
  civilFromDay,
  longDate,
  parseDateField,
  parseRateTable,
  parseTranches,
  postjudgmentInterest,
  postjudgmentReport,
  prejudgmentInterest,
  prejudgmentReport,
  readDateToken,
  tableCellsInsertable,
  type DayCount,
  type InterestMethod,
} from "../damagesInterest";
import { insertableResultText } from "../insertGate";

const D = (s: string): number => {
  const [y, m, d] = s.split("-").map(Number);
  return civilDay(y, m, d);
};

const MINUS = String.fromCharCode(0x2212);

function okTranches(text: string, mid = false) {
  const r = parseTranches(text, mid);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
function okRates(text: string) {
  const r = parseRateTable(text);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
function interestCents(tr: string, rates: string, end: string, method: InterestMethod, dayCount: DayCount, mid = false): number[] {
  const res = prejudgmentInterest({ tranches: okTranches(tr, mid), rates: okRates(rates), end: D(end), method, dayCount });
  if ("error" in res) throw new Error(res.error);
  return res.rows.map((r) => r.interestCents / 100);
}

describe("civil dates", () => {
  test("days_from_civil round-trips and agrees with Date.UTC across 1900-2200", () => {
    for (let n = civilDay(1900, 1, 1); n <= civilDay(2200, 12, 31); n += 97) {
      const { y, m, d } = civilFromDay(n);
      expect(civilDay(y, m, d)).toBe(n);
      expect(Date.UTC(y, m - 1, d) / 86400000).toBe(n);
    }
  });
  test("anniversaries clamp to the month end from the ORIGINAL day", () => {
    expect(longDate(addMonthsClamped(D("2024-01-31"), 1))).toBe("February 29, 2024");
    expect(longDate(addMonthsClamped(D("2023-01-31"), 1))).toBe("February 28, 2023");
    expect(longDate(addMonthsClamped(D("2023-01-31"), 2))).toBe("March 31, 2023");
    expect(longDate(addMonthsClamped(D("2020-02-29"), 12))).toBe("February 28, 2021");
    expect(longDate(addMonthsClamped(D("2020-02-29"), 48))).toBe("February 29, 2024");
  });
  test("date fields: ISO, M/D/YYYY, long form; February 29 of a common year refused by name", () => {
    expect(parseDateField("2024-02-29", "end date")).toBe(D("2024-02-29"));
    expect(parseDateField("2/29/2024", "end date")).toBe(D("2024-02-29"));
    expect(parseDateField("February 29, 2024", "end date")).toBe(D("2024-02-29"));
    expect(parseDateField("Feb. 29 2024", "end date")).toBe(D("2024-02-29"));
    expect(parseDateField("2023-02-29", "end date")).toEqual({ error: "End date: “2023-02-29” is not a calendar date (2023 is not a leap year)." });
    expect(parseDateField("2024-13-01", "end date")).toEqual({ error: expect.stringContaining("no month 13") });
    expect(parseDateField("", "end date")).toEqual({ error: "Enter the end date." });
    expect(parseDateField("tomorrow", "end date")).toEqual({ error: expect.stringContaining("is not a date") });
    expect(parseDateField("1850-01-01", "end date")).toEqual({ error: expect.stringContaining("between 1900 and 2200") });
  });
  test("the long date the product prints parses back", () => {
    const n = D("2031-09-07");
    expect(parseDateField(longDate(n), "x")).toBe(n);
  });
  test("periods: year, quarter, month", () => {
    expect(readDateToken("2019 5", true)).toMatchObject({ from: D("2019-01-01"), to: D("2019-12-31"), period: "year" });
    expect(readDateToken("2019-Q3 5", true)).toMatchObject({ from: D("2019-07-01"), to: D("2019-09-30"), period: "quarter" });
    expect(readDateToken("2020-02\t5", true)).toMatchObject({ from: D("2020-02-01"), to: D("2020-02-29"), period: "month" });
    expect(readDateToken("2019 5", false)).toBeNull();
  });
});

// Case A: three tranches across a three-step rate table, end date Feb 29, 2024.
const TR_A = "Date\tAmount\n2019-03-15\t125000\n12/31/2020, 250,000.50\nJune 30, 2022  98 765,43";
const RATES_A = "From\tRate %\n2018-01-01\t5%\n2020-07-01\t3.25\n2022-01-01\t7,5";
const ORACLE_A: Record<InterestMethod, Record<DayCount, number[]>> = {
  simple: { act365: [34492.29, 48678.18, 12359.21], act360: [34971.35, 49354.27, 12530.86], actact: [34474.04, 48669.84, 12355.94] },
  annual: { act365: [38426.52, 51940.72, 12730.59], act360: [39018.6, 52709.19, 12912.64], actact: [38403.75, 51930.77, 12727.08] },
  quarterly: { act365: [39380.22, 53256.8, 13040.33], act360: [40001.91, 54064.54, 13231.33], actact: [39356.51, 53246.8, 13036.67] },
  monthly: { act365: [39605.5, 53573.97, 13122.15], act360: [40234.32, 54391.39, 13315.56], actact: [39581.56, 53563.9, 13118.47] },
  daily: { act365: [39716.99, 53734.96, 13164.36], act360: [40349.37, 54557.33, 13359.02], actact: [39692.95, 53724.83, 13160.65] },
};

describe("prejudgment interest against the oracle, to the cent", () => {
  for (const method of Object.keys(ORACLE_A) as InterestMethod[]) {
    for (const dc of ["act365", "act360", "actact"] as DayCount[]) {
      test(`case A ${method} ${dc}`, () => {
        expect(interestCents(TR_A, RATES_A, "2024-02-29", method, dc)).toEqual(ORACLE_A[method][dc]);
      });
    }
  }

  test("case B: a Feb 29 accrual, anniversaries on Feb 28 in common years", () => {
    const want: Array<[InterestMethod, DayCount, number]> = [
      ["simple", "act365", 300328.77],
      ["simple", "actact", 300026.5],
      ["annual", "act365", 338653.12],
      ["annual", "actact", 338271.43],
      ["monthly", "act365", 349292.11],
      ["monthly", "actact", 348886.36],
      ["daily", "act365", 350269.34],
      ["daily", "actact", 349861.33],
    ];
    for (const [m, dc, v] of want) expect(interestCents("2016-02-29 1,000,000", "2010-01-01 6", "2021-03-01", m, dc)).toEqual([v]);
  });

  test("case C: a Jan 31 accrual compounded monthly; a rate table with explicit to-dates", () => {
    const rates = "2023-01-01\t2023-06-30\t4\n2023-07-01\t2024-12-31\t8.5";
    const tr = "2023-01-31 50000\n2023-08-15 $1,234.56";
    expect(interestCents(tr, rates, "2024-10-24", "monthly", "act365")).toEqual([6835.74, 131.45]);
    expect(interestCents(tr, rates, "2024-10-24", "quarterly", "act365")).toEqual([6789.67, 130.53]);
    expect(interestCents(tr, rates, "2024-10-24", "simple", "act365")).toEqual([6428.08, 125.35]);
  });

  test("case D: period rows accrue from the period's end, or its midpoint (2019 and 2020 both July 2)", () => {
    expect(interestCents("2019 100000\n2020 100000", "2019-01-01 5", "2023-01-01", "annual", "act365")).toEqual([15793.46, 10265.1]);
    const mid = okTranches("2019 100000\n2020 100000", true);
    expect(mid.map((t) => longDate(t.accrual))).toEqual(["July 2, 2019", "July 2, 2020"]);
    expect(interestCents("2019 100000\n2020 100000", "2019-01-01 5", "2023-01-01", "annual", "act365", true)).toEqual([18679.97, 13013.8]);
  });

  test("the report: grouped money, a table that adds, true conventions in the notes, insertable", () => {
    const r = prejudgmentReport({ tranches: TR_A, rates: RATES_A, end: "2024-02-29", method: "quarterly", dayCount: "act365", midPeriod: "off" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("computed from the inputs given");
    expect(r.text).toContain("Damages 473,765.93 + interest 105,677.35 = 579,443.28");
    expect(r.text).toContain("compounded quarterly");
    expect(r.text).toContain("row 1");
    expect(insertableResultText(r.text)).toBe(true);
    expect(r.text).not.toMatch(/NaN|Infinity|undefined|e\+/);
    const rows = r.table!.rows;
    expect(rows[0]).toEqual(["Damages period / date", "Accrues from", "Days", "Amount", "Interest", "Total"]);
    expect(rows[1]).toEqual(["March 15, 2019", "March 15, 2019", "1,812", "125,000.00", "39,380.22", "164,380.22"]);
    expect(rows[rows.length - 1]).toEqual(["Total", "", "", "473,765.93", "105,677.35", "579,443.28"]);
    expect(r.svg).toContain("<svg");
    expect(r.svg).toContain("damages + interest");
  });
});

describe("the table-cell insert gate", () => {
  test("blank cells pass; an em dash or a broken number blocks the table", () => {
    expect(tableCellsInsertable([["Total", "", "1,234.56"]])).toBe(true);
    expect(tableCellsInsertable([["Total", "—", "1,234.56"]])).toBe(false);
    expect(tableCellsInsertable([["Total", "NaN"]])).toBe(false);
  });
});

describe("prejudgment refusals and hostile input", () => {
  const rep = (tranches: string, rates = "2010-01-01 5", end = "2024-01-01", extra: Partial<{ method: string; dayCount: string; midPeriod: string }> = {}) =>
    prejudgmentReport({ tranches, rates, end, method: "simple", dayCount: "act365", midPeriod: "off", ...extra });

  test("empty fields", () => {
    expect(rep("")).toEqual({ ok: false, text: expect.stringContaining("at least one damages row") });
    expect(rep("2020-01-01 5", "")).toEqual({ ok: false, text: expect.stringContaining("at least one rate row") });
    expect(rep("2020-01-01 5", "2010-01-01 5", "")).toEqual({ ok: false, text: "Enter the end date." });
  });
  test("zero amounts compute to zero; negative amounts are refused by name", () => {
    const r = rep("2020-01-01 0");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Damages 0.00 + interest 0.00 = 0.00");
    const neg = rep(`2020-01-01 ${MINUS}5,000`);
    expect(neg.ok).toBe(false);
    expect(neg.text).toBe(`Damages list, row 1: the amount is negative (${MINUS}5,000.00). Enter damages as positive amounts; credits and offsets are outside this calculator.`);
  });
  test("a tranche after the end date, and an end date before every accrual", () => {
    expect(rep("2025-01-01 100").text).toContain("after the end date (January 1, 2024)");
  });
  test("a tranche on the end date earns nothing", () => {
    const r = rep("2024-01-01 100", "2023-06-01 5");
    expect(r.ok).toBe(true);
    expect(r.table!.rows[1][4]).toBe("0.00");
  });
  test("a gap before the first rate row is refused by name", () => {
    expect(rep("2019-01-01 100", "2020-01-01 5").text).toBe(
      "The rate table starts on January 1, 2020, but interest accrues from January 1, 2019: there is no rate for January 1, 2019 to December 31, 2019. Add a rate row starting on January 1, 2019 or earlier.",
    );
  });
  test("rate rows with gaps, overlaps, duplicates; a closed table that ends early; out-of-order rows", () => {
    expect(rep("2019-01-01 100", "2019-01-01\t2019-06-30\t5\n2019-08-01\t2030-01-01\t6").text).toBe(
      "Rate table: there is no rate from July 1, 2019 to July 31, 2019 (a gap between rows 1 and 2).",
    );
    expect(rep("2019-01-01 100", "2019-01-01\t2019-09-30\t5\n2019-08-01\t6").text).toBe(
      "Rate table: row 1 runs to September 30, 2019, overlapping row 2, which starts on August 1, 2019.",
    );
    expect(rep("2019-01-01 100", "2019-01-01 5\n2019-01-01 6").text).toBe("Rate table: rows 1 and 2 both start on January 1, 2019; keep one.");
    expect(rep("2019-01-01 100", "2019-01-01\t2020-12-31\t5").text).toContain("The rate table ends on December 31, 2020");
    const sorted = rep("2019-01-01 100", "2020-01-01 6\n2019-01-01 5");
    expect(sorted.ok).toBe(true);
    expect(sorted.text).toContain("Rate table rows were put in date order.");
  });
  test("rates: negative, above 100%, not a number", () => {
    expect(rep("2019-01-01 100", "2019-01-01 -1").text).toContain("negative");
    expect(rep("2019-01-01 100", "2019-01-01 150").text).toContain("above 100%");
    expect(rep("2019-01-01 100", "2019-01-01 abc").text).toBe("Rate table, row 1: “abc” is not a rate.");
  });
  test("rows that are not dates; an Excel serial is named", () => {
    expect(rep("2019-01-01 100\nhello 5").text).toContain("row 2: “hello 5” does not start with a date");
    expect(rep("45292\t100").text).toContain("Excel date serial");
    expect(rep("2019-01-01").text).toBe("Damages list, row 1: no amount after the date.");
    expect(rep("2019-01-01 12abc").text).toBe("Damages list, row 1: “12abc” is not an amount.");
    expect(rep("2023-02-29 100").text).toBe("Damages list, row 1: “2023-02-29” is not a calendar date (2023 is not a leap year).");
  });
  test("a table with more than one number column is refused by name, never read from the wrong column", () => {
    // Date | Units | Amount: Units must not be read as the amount.
    expect(rep("Date\tUnits\tAmount\n2019-01-01\t1,200\t50,000.00").text).toBe(
      "Damages list, row 2 has 2 number columns after the date (1,200, 50,000.00); keep only the date and the amount (or a from-date, a to-date and the amount).",
    );
    // The calculator's own inserted table, read back with Use table at cursor.
    const own = prejudgmentReport({ tranches: TR_A, rates: RATES_A, end: "2024-02-29", method: "annual", dayCount: "act365", midPeriod: "off" });
    // Whole table: the trailing Totals row is a totals line (skipped), and the rows are still refused by name below.
    const whole = rep(own.table!.rows.map((r) => r.join("\t")).join("\n"));
    expect(whole.ok).toBe(false);
    expect(whole.text).toContain("Damages list, row 2 has 4 number columns after the date");
    // Without the Totals row: the Days | Amount | Interest | Total columns are refused, not read as an amount.
    const back = own.table!.rows.slice(0, -1).map((r) => r.join("\t")).join("\n");
    const r = rep(back);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("Damages list, row 2 has 4 number columns after the date (1,812, 125,000.00");
    // A text label after the amount is ignored, with a note.
    const lab = rep("2019-01-01\t50,000.00\tLicense year 1");
    expect(lab.ok).toBe(true);
    expect(lab.text).toContain("Note: Damages list: text columns after the amount were ignored.");
    expect(rep("2019-01-01 5", "2010-01-01\t5\t6").text).toContain("Rate table, row 1 has 2 number columns");
  });
  test("mid-period with no period rows is refused by name", () => {
    expect(rep("2019-01-01 100", "2010-01-01 5", "2024-01-01", { midPeriod: "on" }).text).toContain("Mid-period is on, but no damages row names a period");
  });
  test("thousands separators, decimal commas, unicode minus and currency signs read as typed", () => {
    const t = okTranches("2019-01-01 1,234,567.89\n2019-01-02 1.234.567,89\n2019-01-03 €1 234,50\n2019-01-04 $0.01");
    expect(t.map((x) => x.amount)).toEqual([1234567.89, 1234567.89, 1234.5, 0.01]);
  });
  test("1e12 (the cap) stays grouped, never e-notation, exact to the cent; above is refused", () => {
    const r = rep("2020-01-01 1000000000000", "2010-01-01 5", "2021-01-01");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Damages 1,000,000,000,000.00 + interest 50,136,986,301.37");
    // Compounded annually, actual/actual, 3.5 years: the oracle's exact-fraction answer, now to the cent (the
    // engine compounds in double-double; it used to hold 10^15 only to a relative 1e-15).
    const c = rep("2020-01-01 1000000000000", "2010-01-01 5", "2023-07-01", { method: "annual", dayCount: "actact" });
    expect(c.table!.rows[1][4]).toBe("186,327,756,849.32");
    expect(r.text).not.toMatch(/e\+|E\+/);
    expect(rep("2020-01-01 1000000000000.01").text).toContain("outside this calculator");
    expect(rep("2020-01-01 1000000000000000").text).toContain("outside this calculator");
  });
  test("10,000 rows compute fast and the table adds up", () => {
    const lines: string[] = [];
    let want = 0;
    for (let i = 0; i < 10000; i++) {
      const day = civilFromDay(D("2015-01-01") + (i % 3000));
      lines.push(`${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}\t${(1000 + i).toLocaleString("en-US")}.25`);
      want += 1000 + i + 0.25;
    }
    for (const method of ["simple", "monthly", "daily"]) {
      const t0 = Date.now();
      const r = rep(lines.join("\n"), "2014-01-01 5\n2018-07-01 6.5\n2021-03-15 8", "2024-12-31", { method });
      expect(r.ok).toBe(true);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(r.table!.rows.length).toBe(10002);
      const total = r.table!.rows[10001];
      expect(total[3]).toBe(want.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      // the interest column of the totals row is the sum of the rounded rows
      let sum = 0;
      for (let i = 1; i <= 10000; i++) sum += Math.round(Number(r.table!.rows[i][4].replace(/,/g, "")) * 100);
      expect(Math.round(Number(total[4].replace(/,/g, "")) * 100)).toBe(sum);
    }
  });
});

describe("post-judgment interest (28 U.S.C. § 1961) against the oracle", () => {
  test("case P1: three anniversaries, actual/365 and actual/actual", () => {
    const a = postjudgmentInterest({ amount: 1469135.78, rate: 0.0412, judgment: D("2024-03-15"), payment: D("2026-10-24"), dayCount: "act365" });
    if ("error" in a) throw new Error(a.error);
    expect(a.years.map((y) => y.interestCents / 100)).toEqual([60528.39, 63022.16, 40090.31]);
    expect(a.years.map((y) => y.days)).toEqual([365, 365, 223]);
    expect(a.totalInterestCents / 100).toBe(163640.86);
    const b = postjudgmentInterest({ amount: 1469135.78, rate: 0.0412, judgment: D("2024-03-15"), payment: D("2026-10-24"), dayCount: "actact" });
    if ("error" in b) throw new Error(b.error);
    expect(b.years.map((y) => y.interestCents / 100)).toEqual([60396.09, 63016.71, 40086.85]);
    expect((b.amountCents + b.totalInterestCents) / 100).toBe(1632635.43);
  });
  test("case P2: a Feb 29 judgment compounds on Feb 28 in common years", () => {
    const a = postjudgmentInterest({ amount: 2500000, rate: 0.0507, judgment: D("2020-02-29"), payment: D("2023-06-01"), dayCount: "act365" });
    if ("error" in a) throw new Error(a.error);
    expect(a.years.map((y) => longDate(y.from))).toEqual(["February 29, 2020", "February 28, 2021", "February 28, 2022", "February 28, 2023"]);
    expect(a.years.map((y) => y.interestCents / 100)).toEqual([126750, 133176.23, 139928.26, 37460.56]);
    // 2,626,750 × 5.07% is exactly 133,176.225: a half-cent tie, rounded half up (the oracle works in exact fractions).
    expect(a.totalInterestCents / 100).toBe(437315.05);
    const b = postjudgmentInterest({ amount: 2500000, rate: 0.0507, judgment: D("2020-02-29"), payment: D("2023-06-01"), dayCount: "actact" });
    if ("error" in b) throw new Error(b.error);
    expect(b.totalInterestCents / 100).toBe(436989.32);
  });
  test("case P3: under a year is simple", () => {
    const a = postjudgmentInterest({ amount: 1e7, rate: 0.0013, judgment: D("2021-01-04"), payment: D("2021-12-31"), dayCount: "act365" });
    if ("error" in a) throw new Error(a.error);
    expect(a.totalInterestCents / 100).toBe(12857.53);
  });
  test("the report quotes § 1961 verbatim and never states the rate as law", () => {
    const r = postjudgmentReport({ amount: 1469135.78, ratePct: 4.12, judgment: "2024-03-15", payment: "10/24/2026", dayCount: "act365" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Judgment 1,469,135.78 + interest 163,640.86 = 1,632,776.64 on October 24, 2026");
    expect(r.text).toContain("“Interest shall be computed daily to the date of payment … and shall be compounded annually.”");
    expect(r.text).toContain("the rate here is the one entered");
    expect(insertableResultText(r.text)).toBe(true);
    const rows = r.table!.rows;
    expect(rows[1]).toEqual(["1", "March 15, 2024", "March 14, 2025", "365", "1,469,135.78", "60,528.39", "1,529,664.17"]);
    expect(rows[rows.length - 1]).toEqual(["Total", "", "", "953", "1,469,135.78", "163,640.86", "1,632,776.64"]);
    expect(r.svg).toContain("<svg");
  });
  test("refusals: payment before judgment, negative rate, same-day payment is zero", () => {
    expect(postjudgmentReport({ amount: 100, ratePct: 5, judgment: "2024-03-15", payment: "2024-03-14", dayCount: "act365" }).text).toBe(
      "The payment date (March 14, 2024) is before the judgment date (March 15, 2024).",
    );
    expect(postjudgmentReport({ amount: 100, ratePct: -1, judgment: "2024-03-15", payment: "2025-03-14", dayCount: "act365" }).ok).toBe(false);
    expect(postjudgmentReport({ amount: -100, ratePct: 1, judgment: "2024-03-15", payment: "2025-03-14", dayCount: "act365" }).ok).toBe(false);
    const z = postjudgmentReport({ amount: 100, ratePct: 5, judgment: "2024-03-15", payment: "2024-03-15", dayCount: "act365" });
    expect(z.ok).toBe(true);
    expect(z.text).toContain("interest 0.00");
    expect(z.svg).toBeUndefined();
  });
});
