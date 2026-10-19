// Whether a Stats field's commas separate values, decided over the WHOLE field (statFields.ts, moved out of
// taskpane.ts unchanged). It is numberList's commaMode for the whole text, so it answers "separator" only
// when readNumberList would split on the commas.
import { statFieldCommasAreSeparators } from "../statFields";

describe("statFieldCommasAreSeparators", () => {
  it("a comma-run list is listing", () => {
    expect(statFieldCommasAreSeparators("1,2,3")).toBe(true);
  });

  it("one comma per space-separated value is a decimal comma, not listing", () => {
    expect(statFieldCommasAreSeparators("1,5 2,3 3,1")).toBe(false);
  });

  it("one listing group makes the whole field listing (4,5 6 is then 4, 5, 6)", () => {
    expect(statFieldCommasAreSeparators("1,2,3\n\n4,5 6")).toBe(true);
  });

  it("comma-then-space is already split by the spaces, so it does not need forcing", () => {
    expect(statFieldCommasAreSeparators("1, 2, 3")).toBe(false);
    expect(statFieldCommasAreSeparators("1 2 3")).toBe(false);
  });

  it("a field of one token or none reads its commas as separators (numberList's rule)", () => {
    expect(statFieldCommasAreSeparators("1,5")).toBe(true);
    expect(statFieldCommasAreSeparators("")).toBe(true);
  });
});
