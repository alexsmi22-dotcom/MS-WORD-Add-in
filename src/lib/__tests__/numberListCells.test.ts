// A group or row of one value in a decimal-comma Stats field is a cell ("3,5" is 3.5), as the whole field
// decided — read alone it was a comma list, 3 and 5 (numberList.ts `cells`).
import { readNumberList } from "../numberList";
import { statFieldCommasAreSeparators } from "../statFields";

/** What statGroups does with a field (taskpane.ts): the comma's role decided once, each group read under it. */
const groups = (field: string): number[][] => {
  const sep = statFieldCommasAreSeparators(field);
  return field
    .split(/\n\s*\n|;/)
    .map((g) => readNumberList(sep ? g.replace(/,/g, " ") : g, { cells: !sep }).values)
    .filter((g) => g.length > 0);
};

describe("readNumberList cells", () => {
  it("a lone value in a decimal-comma field's group is one number", () => {
    expect(groups("1,5 2,5\n\n3,5")).toEqual([[1.5, 2.5], [3.5]]);
  });

  it("a one-column table of decimal commas is one column", () => {
    expect(statFieldCommasAreSeparators("1,5\n2,5")).toBe(false);
    expect("1,5\n2,5".split("\n").map((row) => readNumberList(row, { cells: true }).values)).toEqual([[1.5], [2.5]]);
  });

  it("the cell reading still reports its decimal commas (the note is said)", () => {
    const r = readNumberList("3,5", { cells: true });
    expect(r).toMatchObject({ values: [3.5], commaMode: "cell", decimalCommas: 1, example: "3,5" });
  });

  it("without `cells` nothing changes: one run is still a comma list", () => {
    expect(readNumberList("3,5").values).toEqual([3, 5]);
    expect(readNumberList("1,2,3").values).toEqual([1, 2, 3]);
  });

  it("a comma-listing field is unchanged (its groups are split on commas before reading)", () => {
    expect(groups("1,2,3\n\n4,5 6")).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
});
