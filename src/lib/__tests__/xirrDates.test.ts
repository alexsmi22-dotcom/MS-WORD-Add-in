/**
 * F1 D3: XIRR takes calendar dates (lib/xirrDates.ts), checked against Microsoft's published XIRR example: values
 * −10,000, 2,750, 4,250, 3,250, 2,750 on 2008-01-01, 2008-03-01, 2008-10-30, 2009-02-15, 2009-04-01 → 0.373362535
 * (Excel XIRR function documentation, "Example"). Plain numbers still read as day counts.
 */
import { readXirrDates, XIRR_MAX_FLOWS } from "../xirrDates";
import { xirr } from "../finance";

const MS_VALUES = [-10000, 2750, 4250, 3250, 2750];
const MS_DATES = ["2008-01-01", "2008-03-01", "2008-10-30", "2009-02-15", "2009-04-01"];

describe("readXirrDates", () => {
  test("Microsoft's XIRR example, one date per line → 0.373362535", () => {
    const d = readXirrDates(MS_DATES.join("\n"));
    if ("error" in d) throw new Error(d.error);
    expect(d.kind).toBe("dates");
    expect(d.days).toEqual([0, 60, 303, 411, 456]);
    expect(xirr(MS_VALUES, d.days)!).toBeCloseTo(0.373362535, 8);
    expect(d.span).toBe("January 1, 2008 to April 1, 2009");
  });

  test("the same dates comma- or semicolon-separated, US style, written out, with a column title", () => {
    for (const raw of [
      MS_DATES.join(", "),
      MS_DATES.join("; "),
      "1/1/2008, 3/1/2008, 10/30/2008, 2/15/2009, 4/1/2009",
      "January 1, 2008\nMarch 1, 2008\nOctober 30, 2008\nFebruary 15, 2009\nApril 1, 2009",
      ["Date", ...MS_DATES].join("\n"),
    ]) {
      const d = readXirrDates(raw);
      if ("error" in d) throw new Error(`${raw}: ${d.error}`);
      expect(d.days).toEqual([0, 60, 303, 411, 456]);
    }
    const titled = readXirrDates(["Date", ...MS_DATES].join("\n"));
    expect("note" in titled && titled.note).toContain("column title");
  });

  test("plain numbers are day counts, as before", () => {
    const d = readXirrDates("0, 180, 300, 450");
    if ("error" in d) throw new Error(d.error);
    expect(d).toEqual({ days: [0, 180, 300, 450], kind: "days", note: undefined });
  });

  test("refusals name the problem", () => {
    const bad = (raw: string): string => {
      const d = readXirrDates(raw);
      return "error" in d ? d.error : "";
    };
    expect(bad("")).toContain("Enter one date per cash flow");
    expect(bad("2008-01-01\nsoon")).toContain("“soon” is not a date");
    expect(bad("2009-02-29\n2009-03-01")).toContain("2009 is not a leap year");
    expect(bad("2008-03-01\n2008-01-01")).toContain("before the first date");
    expect(bad(Array.from({ length: XIRR_MAX_FLOWS + 1 }, (_, i) => String(i)).join("\n"))).toContain("takes at most 400");
  });
});
