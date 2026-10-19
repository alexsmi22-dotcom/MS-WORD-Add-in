// A group or row of one value in a Stats field that PROVES decimal commas is a cell ("4,5" is 4.5) — read alone
// it was a comma list, 4 and 5. A field that proves nothing keeps each piece a comma list (numberList.ts
// `cells`, statFields.ts statFieldProvesDecimalCommas).
import { readNumberList } from "../numberList";
import { statFieldCommasAreSeparators, statFieldProvesDecimalCommas } from "../statFields";

/** What statGroups / statTable do with a field (taskpane.ts): the comma's role decided once, each piece read under it. */
const pieces = (field: string, split: RegExp): number[][] => {
  const sep = statFieldCommasAreSeparators(field);
  const parts = field.split(split);
  const cells = !sep && statFieldProvesDecimalCommas(parts);
  return parts.map((g) => readNumberList(sep ? g.replace(/,/g, " ") : g, { cells }).values).filter((g) => g.length > 0);
};
const groups = (field: string): number[][] => pieces(field, /\n\s*\n|;/);
const table = (field: string): number[][] => pieces(field, /\n|;/);

describe("a lone value in a field that proves decimal commas", () => {
  it("is one number", () => {
    expect(groups("1,5 2,5\n\n3,5")).toEqual([[1.5, 2.5], [3.5]]);
    expect(table("1,5 2,5\n4,5")).toEqual([[1.5, 2.5], [4.5]]);
  });

  it("the cell reading still reports its decimal commas (the note is said)", () => {
    expect(readNumberList("3,5", { cells: true })).toMatchObject({ values: [3.5], commaMode: "cell", decimalCommas: 1, example: "3,5" });
  });
});

describe("a field that proves nothing keeps each piece a comma list (v2.160.0 review)", () => {
  it("a 2 × 2 table typed 10,20 / 30,40 is a 2 × 2 table, not 10.2 and 30.4", () => {
    expect(table("10,20\n30,40")).toEqual([[10, 20], [30, 40]]);
  });
  it("100,200 / 300,400 is four values, not 100200 and 300400", () => {
    expect(table("100,200\n300,400")).toEqual([[100, 200], [300, 400]]);
  });
  it("groups 1,2;3,4 and 10,20;30,40;50,60 are groups of two", () => {
    expect(groups("1,2;3,4")).toEqual([[1, 2], [3, 4]]);
    expect(groups("10,20;30,40;50,60")).toEqual([[10, 20], [30, 40], [50, 60]]);
  });
  it("a one-column table 1,5 / 2,5 is ambiguous and stays as before (two values per row)", () => {
    expect(table("1,5\n2,5")).toEqual([[1, 5], [2, 5]]);
  });
  it("a comma-listing field is unchanged (its pieces are split on commas)", () => {
    expect(groups("1,2,3\n\n4,5 6")).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
  it("a piece of spaced thousands (1,200 3,400) proves no decimal comma", () => {
    expect(statFieldProvesDecimalCommas(["1,200 3,400", "5,600"])).toBe(false);
    expect(table("1,200 3,400\n5,600")).toEqual([[1200, 3400], [5, 600]]);
  });
});

describe("without `cells` nothing changes", () => {
  it("one run is still a comma list", () => {
    expect(readNumberList("3,5").values).toEqual([3, 5]);
    expect(readNumberList("1,2,3").values).toEqual([1, 2, 3]);
  });
});
