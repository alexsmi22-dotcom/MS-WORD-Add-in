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
