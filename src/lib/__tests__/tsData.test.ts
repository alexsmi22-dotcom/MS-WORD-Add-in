/** Release E3's shared series reader: dates and periods, the regression reader's number rules, gaps refused. */
import { parseSeriesTable, pickSeries } from "../tsData";

const ok = (text: string, opts = {}) => {
  const r = parseSeriesTable(text, opts);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};
const bad = (text: string, opts = {}) => {
  const r = parseSeriesTable(text, opts);
  if (r.ok) throw new Error("expected a refusal");
  return r.reason;
};

describe("parseSeriesTable", () => {
  test("a headed quarterly table: periods, a value column, frequency quarter", () => {
    const d = ok("Quarter\tGDP\n2019-Q1\t100\n2019-Q2\t101,5\n2019-Q3\t103\n2019-Q4\t104");
    expect(d.dates!.frequency).toBe("quarter");
    expect(d.dates!.name).toBe("Quarter");
    expect(d.dates!.tokens.map((t) => t.label)).toEqual(["2019 Q1", "2019 Q2", "2019 Q3", "2019 Q4"]);
    expect(d.names).toEqual(["GDP"]);
    expect(Array.from(d.cols[0])).toEqual([100, 101.5, 103, 104]);
    expect(d.notes.join(" ")).toContain("decimal comma");
  });
  test("a headerless monthly table is data from its first row", () => {
    const d = ok("2020-01\t4.1\n2020-02\t4.3\n2020-03\t4.0");
    expect(d.n).toBe(3);
    expect(d.dates!.frequency).toBe("month");
    expect(d.names).toEqual(["Value"]);
  });
  test("daily dates in three spellings, several columns; trading days may skip weekends", () => {
    const d = ok("Date\tFirm\tMarket\n2024-01-05\t0.01\t0.002\n1/8/2024\t−0.02\t0.001\nJanuary 9, 2024\t0.003\t−0.004");
    expect(d.dates!.frequency).toBe("day");
    expect(d.names).toEqual(["Firm", "Market"]);
    expect(Array.from(d.cols[0])).toEqual([0.01, -0.02, 0.003]);
  });
  test("no date column: plain values, one or more columns", () => {
    const d = ok("5\n6\n7\n9");
    expect(d.dates).toBeUndefined();
    expect(Array.from(d.cols[0])).toEqual([5, 6, 7, 9]);
    expect(ok("a\tb\n1\t2\n3\t4\n5\t6").names).toEqual(["a", "b"]);
    expect(bad("5\n6\n7", { requireDates: true })).toContain("Put the dates in the first column");
  });
  test("a gap in a periodic table is reported as irregular, with the gap named", () => {
    const d = ok("2019-Q1\t1\n2019-Q2\t2\n2019-Q4\t3");
    expect(d.dates!.frequency).toBe("irregular");
    expect(d.dates!.gap).toBe("2019 Q2 is followed by 2019 Q4");
  });
  test("refusals: missing value by row and period, out of order, duplicate, bad date, too few rows", () => {
    expect(bad("Year\tCPI\n2019\t255.7\n2020\t\n2021\t271.0", {})).toBe(
      "Row 2 (2020) has no value in “CPI”. A series needs a value in every row; fill or remove the row.",
    );
    expect(bad("2020\t1\n2019\t2\n2021\t3")).toContain("list the rows oldest first");
    expect(bad("2020\t1\n2020\t2\n2021\t3")).toContain("both date 2020");
    expect(bad("Date\tx\n2023-02-29\t1\n2023-03-01\t2\n2023-03-02\t3")).toContain("2023 is not a leap year");
    expect(bad("Date\tx\n2023-02-27\t1\nsoon\t2\n2023-03-02\t3")).toContain("“soon” in “Date” is not a date or period");
    expect(bad("2020\t1\n2021\t2")).toContain("at least 3 are needed");
  });
  test("the regression reader's decimal-comma refusals apply to series too", () => {
    expect(bad("y;x\n1;3,5\n2;2.345\n3;4,1")).toContain("may be a thousands separator");
  });
  test("pickSeries: by name (any case), the only column, or a refusal naming the columns", () => {
    const d = ok("Date\tFirm\tMarket\n2024-01-05\t1\t2\n2024-01-08\t3\t4\n2024-01-09\t5\t6");
    const p = pickSeries(d, "market");
    expect(p.ok && p.name).toBe("Market");
    const none = pickSeries(d, "");
    expect(!none.ok && none.reason).toContain("name the one to use");
    const missing = pickSeries(d, "Bond");
    expect(!missing.ok && missing.reason).toBe("No column is named “Bond”; the columns are “Firm”, “Market”.");
  });
});

describe("E3 review round", () => {
  test("spreadsheet date spellings: 2024/01/02 and a midnight time", () => {
    const d = ok("Date\tx\n2024/01/02\t1\n2024-01-03 00:00:00\t2\n2024-01-04T00:00\t3");
    expect(d.dates!.tokens.map((t) => t.label)).toEqual(["January 2, 2024", "January 3, 2024", "January 4, 2024"]);
  });
  test("a day inside the period before it overlaps", () => {
    expect(bad("2020-01\t1\n2020-01-15\t2\n2020-03\t3")).toContain("overlaps");
    expect(bad("2020\t1\n2020-06-15\t2\n2021\t3")).toContain("overlaps");
  });
  test("% signs: a whole column is flagged percent; a mixed column is refused", () => {
    expect(ok("a\tb\n1%\t1\n2%\t2\n3%\t3").percent).toEqual([true, false]);
    expect(bad("a\n1%\n2\n3%")).toContain("some values with a % sign (row 1) and some without (row 2)");
  });
});
