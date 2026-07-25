// Tests for the offline word-problem parser. The parser is deliberately
// conservative, so the tests check BOTH that it solves the templates it claims
// AND that it returns null (never a fabricated answer) on anything it cannot map.

import { solveWordProblem } from "../wordproblem";

describe("percentage", () => {
  const cases: [string, number][] = [
    ["What is 15% of 200?", 30],
    ["15 percent of 200", 30],
    ["12 is what percent of 48?", 25],
    ["9 is 30% of what?", 30],
    ["What is 8.5% of 40?", 3.4],
  ];
  for (const [q, want] of cases) {
    it(q, () => {
      const r = solveWordProblem(q);
      expect(r).not.toBeNull();
      expect(r!.template).toBe("percentage");
      expect(r!.value).toBeCloseTo(want, 6);
    });
  }
});

describe("distance = rate × time", () => {
  it("finds distance", () => {
    const r = solveWordProblem("A car travels at 60 mph for 3 hours. How far does it go?");
    expect(r?.value).toBeCloseTo(180, 6);
  });
  it("finds speed", () => {
    const r = solveWordProblem("A runner covers 10 miles in 2 hours. How fast is the runner?");
    expect(r?.value).toBeCloseTo(5, 6);
  });
  it("finds time", () => {
    const r = solveWordProblem("How long does it take to travel 150 miles at 50 mph?");
    expect(r?.value).toBeCloseTo(3, 6);
  });
});

describe("linear number sentences", () => {
  const cases: [string, number][] = [
    ["Twice a number plus 7 is 15", 4],
    ["5 less than a number is 12", 17],
    ["3 more than a number equals 10", 7],
    ["Half a number is 8", 16],
    ["Double the number minus 4 is 10", 7],
    ["A number increased by 9 is 21", 12],
  ];
  for (const [q, want] of cases) {
    it(q, () => {
      const r = solveWordProblem(q);
      expect(r).not.toBeNull();
      expect(r!.template).toBe("linear number sentence");
      expect(r!.value).toBeCloseTo(want, 6);
      expect(r!.equation).toBeTruthy();
    });
  }
});

describe("honesty — refuses what it cannot parse (never fabricates)", () => {
  const unparseable = [
    "What is the meaning of life?",
    "Two trains leave different stations and a bird flies between them",
    "If a farmer has some chickens and cows with 20 heads and 56 legs",
    "",
    "Solve the Riemann hypothesis",
    "A number", // no relation, nothing to solve
  ];
  for (const q of unparseable) {
    it(`returns null: "${q}"`, () => {
      expect(solveWordProblem(q)).toBeNull();
    });
  }
});
