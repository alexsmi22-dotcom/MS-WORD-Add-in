/**
 * Fix round 2, Finance B1 + MINOR 8: the lone grouped run in the shared list reader (numberList.ts).
 * B1 repro: npv flows "-1,000,500,500,500" read as ONE flow, −1,000,500,500,500 (IRR then said "no solution");
 * before fix-statA the reader asked. MINOR 8: a lone "1,500" read as [1, 500] while "1,000" read as 1000.
 */
import { readNumberList } from "../numberList";
import { readCalcList, ListTokenError } from "../calcList";
import { statFieldCommasAreSeparators } from "../statFields";

const asks = (s: string): string => {
  try {
    readCalcList(s);
  } catch (e) {
    if (e instanceof ListTokenError) return e.message;
    throw e;
  }
  return "";
};

describe("B1: several commas with a group that is not 000 are asked, never one silent number", () => {
  test.each(["-1,000,500,500,500", "5,000,100,200", "250,000,050", "1,000,500"])("%s", (s) => {
    expect(readNumberList(s).ambiguous).toMatch(/reads two ways/);
    expect(asks(s)).toMatch(/reads two ways: the numbers/);
    // the list reading is kept for the readers that do not ask (Stats), as before fix-statA
    expect(readNumberList(s).values.length).toBe(s.split(",").length);
  });
  test("the B1 repro names both readings", () => {
    expect(asks("-1,000,500,500,500")).toBe(
      "“-1,000,500,500,500” reads two ways: the numbers -1, 000, 500, 500, 500, or one number grouped in thousands (-1000500500500). Separate several numbers with “, ” (comma and space) or semicolons, or write one number without its commas.",
    );
  });
});

describe("the one-number shapes stay one number", () => {
  test.each([
    ["1,000", 1000],
    ["−2,050", -2050],
    ["10,000.5", 10000.5],
    ["1,000,000", 1000000],
    ["12,000,000", 12000000],
    ["4,000,000", 4000000],
    ["-1,000,000,000", -1000000000],
  ])("%s", (s, v) => {
    const r = readNumberList(s);
    expect(r.ambiguous).toBeUndefined();
    expect(r.values).toEqual([v]);
    expect(readCalcList(s).values).toEqual([v]);
  });
});

describe("MINOR 8: a lone single comma without the 0 tell is asked (three readings), not silently two values", () => {
  test("1,500", () => {
    expect(asks("1,500")).toBe(
      "“1,500” reads three ways: the numbers 1 and 500, one number grouped in thousands (1500), or a decimal comma (1.500). Separate two numbers with “, ” (comma and space) or a semicolon, or write one number without the comma.",
    );
  });
  test("a decimal point leaves out the decimal-comma reading", () => {
    expect(asks("1,500.5")).toMatch(/^“1,500\.5” reads two ways/);
  });
  test("unambiguous shapes still read", () => {
    expect(readCalcList("1, 500").values).toEqual([1, 500]);
    expect(readCalcList("1;500").values).toEqual([1, 500]);
    expect(readCalcList("1500").values).toEqual([1500]);
    expect(readCalcList("12,15").values).toEqual([12, 15]);
    expect(readCalcList("-1000,300,400,500").values).toEqual([-1000, 300, 400, 500]);
    expect(readCalcList("1,500 2,500").values).toEqual([1500, 2500]);
    // a leading 0 is never thousands: the plain list, unasked, as before
    expect(readCalcList("0,500").values).toEqual([0, 500]);
  });
  test("Stats readers keep the list reading of a table row (they do not ask)", () => {
    expect(readNumberList("100,200").values).toEqual([100, 200]);
    expect(statFieldCommasAreSeparators("100,200")).toBe(true);
  });
});
