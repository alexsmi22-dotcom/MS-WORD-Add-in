import { parseRegData } from "../regData";

// F2 (found by the securities builder): a headerless whitespace table whose first row has a grouped number was taken
// for a CSV header and split at its thousands commas.
describe("whitespace table with grouped numbers in the first row", () => {
  test("date + grouped number reads as two cells per row", () => {
    const r = parseRegData("2025-03-03 2,401,000\n2025-03-04 2,500,000");
    expect(r.ok && r.data.rows).toEqual([["2025-03-03", "2,401,000"], ["2025-03-04", "2,500,000"]]);
  });
  test("a comma between cells is still a CSV header", () => {
    for (const t of ["Date,Close\n2025-03-03,10", "Date, Close\n2025-03-03, 10"]) {
      const r = parseRegData(t);
      expect(r.ok && r.data.names).toEqual(["Date", "Close"]);
    }
  });
});

// F2 review: the grouped-number exception must not swallow header-less CSV rows whose first cell has a space.
describe("header-less CSV rows with a space in the first cell stay CSV", () => {
  test.each([
    ["Mar 3 2025,10\nMar 4 2025,11", [["Mar 3 2025", "10"], ["Mar 4 2025", "11"]]],
    ["Plant 1,5.2,3.1\nPlant 2,6.1,2.9", [["Plant 1", "5.2", "3.1"], ["Plant 2", "6.1", "2.9"]]],
  ])("%s", (text, rows) => {
    const r = parseRegData(text);
    expect(r.ok && r.data.rows).toEqual(rows);
  });
  test("decimal-comma whitespace table is unchanged", () => {
    const r = parseRegData("1,5 2,3\n3,5 4,1");
    expect(r.ok && r.data.rows).toEqual([["1,5", "2,3"], ["3,5", "4,1"]]);
  });
});
