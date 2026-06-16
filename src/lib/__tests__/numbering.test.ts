import { toRoman, peekFormulaNumber, nextFormulaNumber, resetFormulaNumbering } from "../numbering";

describe("toRoman", () => {
  it.each([
    [1, "I"],
    [4, "IV"],
    [9, "IX"],
    [14, "XIV"],
    [40, "XL"],
    [90, "XC"],
    [2024, "MMXXIV"],
  ])("%i -> %s", (n, roman) => {
    expect(toRoman(n)).toBe(roman);
  });

  it("clamps to at least I", () => {
    expect(toRoman(0)).toBe("I");
  });
});

describe("formula counter without localStorage", () => {
  it("degrades gracefully to defaults when storage is unavailable", () => {
    // In the Node test environment there is no localStorage; the functions are
    // try/catch-guarded and should not throw.
    expect(() => resetFormulaNumbering()).not.toThrow();
    expect(peekFormulaNumber()).toBe(1);
    expect(nextFormulaNumber()).toBe(1);
  });
});
