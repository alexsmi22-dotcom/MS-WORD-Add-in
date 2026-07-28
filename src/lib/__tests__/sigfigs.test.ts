// Significant figures, counted from what the user actually wrote.
//
// This exists because a lab report is marked on precision as much as on the
// number. Quoting a stress to seven figures from inputs measured to two is
// wrong in the way that matters to a demonstrator, and it is the kind of wrong
// a calculator produces by default.

import { significantFigures, resultFigures } from "../units";

describe("significantFigures", () => {
  const cases: [string, number][] = [
    ["5", 1],
    ["50", 1], // trailing zero in a bare integer: ambiguous, not counted
    ["1000", 1],
    ["1200", 2],
    ["1000.", 4], // the point is how a student says "I mean four"
    ["5.0", 2],
    ["5.00", 3],
    ["0.0042", 2], // leading zeros never count
    ["0.004200", 4], // trailing zeros AFTER a point do count
    ["12.345", 5],
    ["1.000e3", 4],
    ["2.5e-6", 2],
    ["-47.0", 3],
    ["0", 1],
    ["0.0", 1],
  ];
  for (const [text, want] of cases) {
    test(`${text} has ${want}`, () => expect(significantFigures(text)).toBe(want));
  }

  test("non-numbers return null rather than a guess", () => {
    expect(significantFigures("12 kN")).toBeNull();
    expect(significantFigures("")).toBeNull();
    expect(significantFigures("abc")).toBeNull();
  });
});

describe("resultFigures", () => {
  test("a product is quoted to the fewest figures any input carries", () => {
    expect(resultFigures(["5.0", "1.2345"])).toBe(2);
    expect(resultFigures(["12.345", "6.7890"])).toBe(5);
  });

  test("unreadable inputs are ignored, not treated as infinitely precise", () => {
    expect(resultFigures(["5.00", "mm", ""])).toBe(3);
  });

  test("nothing countable falls back rather than collapsing to one figure", () => {
    expect(resultFigures(["mm", ""])).toBe(4);
    expect(resultFigures([], 3)).toBe(3);
  });

  test("clamped to a sane band", () => {
    // One figure is technically correct for "5" but useless on a report, and
    // more than six is beyond what any of these inputs support.
    expect(resultFigures(["5"])).toBe(2);
    expect(resultFigures(["1.2345678901"])).toBe(6);
  });
});
