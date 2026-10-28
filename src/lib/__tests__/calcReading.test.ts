import { readingProblems, READING_MAX } from "../calcReading";

describe("readingProblems (the rules every Finance and Statistics reading keeps)", () => {
  test("a plain two-sentence reading with Unicode typesetting passes", () => {
    expect(
      readingProblems(
        "The loan costs $1,073.64 a month. Over 30 years you pay $186,511.57 in interest, 0.5% of it in the first year."
      )
    ).toEqual([]);
    expect(readingProblems("GPA raises the odds of a better grade about 16.9× per point (p = 0.0251, R² = 0.34).")).toEqual([]);
  });

  test("decimals and initials do not count as sentence breaks", () => {
    expect(readingProblems("The U.S. rate of 4.25% gives a forward of 1.2625. That is 0.0026 below the quote.")).toEqual([]);
  });

  test("each broken rule is named", () => {
    expect(readingProblems("")).toEqual(["no reading"]);
    expect(readingProblems(undefined)).toEqual(["no reading"]);
    expect(readingProblems("One. Two. Three.")).toContain("more than two sentences (3)");
    expect(readingProblems("No full stop")).toContain("does not end with a full stop");
    expect(readingProblems("The value is —.")).toContain("contains an em dash (the no-value sentinel)");
    expect(readingProblems("The value is NaN.")).toContain("contains a non-number word");
    expect(readingProblems("The area is 3 m^2.")).toContain("contains an ASCII exponent (^)");
    expect(readingProblems("The p-value is 1e-5.")).toContain("contains computer scientific notation (1e-5)");
    expect(readingProblems("Conventions follow the reference.")).toContain("contains a method note");
    expect(readingProblems("x".repeat(READING_MAX) + ".")[0]).toMatch(/^longer than/);
  });
});
