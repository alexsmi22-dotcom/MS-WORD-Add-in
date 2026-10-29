import { readingProblems, READING_MAX, pVerdict, BOUNDARY_CLAUSE } from "../calcReading";

describe("pVerdict (one printed p, one verdict)", () => {
  test("decides on the printed p at any precision and in any house format", () => {
    for (const s of ["0.049", "0.0499", ".003", "p = .003", "< 0.001", "p < 0.001", "p < .001", "0.0000"]) expect(pVerdict(s)).toBe("clear");
    for (const s of ["0.05", ".050", "0.050", "0.0500", "p = 0.050", "= .05"]) expect(pVerdict(s)).toBe("borderline");
    for (const s of ["0.051", ".0501", "0.41", "1.000", "p = .570"]) expect(pVerdict(s)).toBe("none");
  });
  test("a different alpha (Tukey's family-wise 0.01, 0.10)", () => {
    expect(pVerdict("0.010", 0.01)).toBe("borderline");
    expect(pVerdict("0.009", 0.01)).toBe("clear");
    expect(pVerdict("0.08", 0.1)).toBe("clear");
  });
  test("an unreadable printed p is a programming error, not a verdict", () => {
    expect(() => pVerdict("n/a")).toThrow();
  });
  test("the boundary clause keeps the reading rules", () => {
    expect(readingProblems(`The difference is ${BOUNDARY_CLAUSE} (p = 0.050).`)).toEqual([]);
  });
});

describe("readingProblems (the rules every Finance and Statistics reading keeps)", () => {
  test("a plain two-sentence reading with Unicode typesetting passes", () => {
    expect(
      readingProblems(
        "The loan costs $1,073.64 a month. Over 30 years you pay $186,511.57 in interest, 0.5% of it in the first year."
      )
    ).toEqual([]);
    expect(readingProblems("GPA raises the odds of a better grade about 16.9× per point (p = 0.0251, R² = 0.34).")).toEqual([]);
  });

  test("company and person abbreviations in names do not count as sentence breaks (R6 #15)", () => {
    expect(readingProblems("The merger of Acme Inc. Holdings and Birch Co. Partners raises the HHI by 360. That presumption is a screen.")).toEqual([]);
    expect(readingProblems("One. Two. Three.")).toContain("more than two sentences (3)");
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
