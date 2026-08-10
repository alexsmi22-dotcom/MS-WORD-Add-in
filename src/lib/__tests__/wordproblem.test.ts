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

describe("survey percentage", () => {
  const SURVEY =
    "In a survey of 20 people, 8 people said they liked chocolate ice cream, and 12 people said they liked vanilla. What is the percentage of people who like chocolate ice cream?";

  it("answers the survey question and quotes the clause it counted", () => {
    const r = solveWordProblem(SURVEY)!;
    expect(r.template).toBe("survey percentage");
    expect(r.answer).toBe("40%");
    expect(r.steps.join(" ")).toContain("8 people said they liked chocolate ice cream");
    expect(r.steps.join(" ")).toContain("survey of 20");
    expect(r.steps.join(" ")).not.toContain("vanilla");
  });

  it("the OTHER category answers with its own count", () => {
    const r = solveWordProblem(SURVEY.replace(/chocolate ice cream\?$/, "vanilla?"))!;
    expect(r.answer).toBe("60%");
    expect(r.steps.join(" ")).toContain("12 people said they liked vanilla");
  });

  it("count and total sharing a clause still resolve", () => {
    const r = solveWordProblem(
      "8 of the students in a class of 25 said they prefer tea. What percentage of students who prefer tea?"
    )!;
    expect(r.answer).toBe("32%");
  });

  it("null, never a guess: negated question (complement needs disjoint, exhaustive categories)", () => {
    expect(solveWordProblem(SURVEY.replace("who like chocolate", "who did not like chocolate"))).toBeNull();
  });

  it("null, never a guess: no stated total — categories are never summed", () => {
    expect(
      solveWordProblem("8 people said they liked chocolate, and 12 people said they liked vanilla. What is the percentage of people who like chocolate?")
    ).toBeNull();
  });

  it("null, never a guess: two clauses tie different counts to the asked category", () => {
    expect(
      solveWordProblem("In a survey of 20 people, 8 liked chocolate ice cream, 5 liked chocolate cake. What is the percentage of people who like chocolate?")
    ).toBeNull();
  });

  it("null: a count larger than the stated total is not a share of it", () => {
    expect(
      solveWordProblem("In a survey of 20 people, 30 said they liked chocolate. What is the percentage of people who like chocolate?")
    ).toBeNull();
  });

  it("does not steal the plain percentage templates", () => {
    expect(solveWordProblem("12 is what percent of 48?")!.template).toBe("percentage");
    expect(solveWordProblem("What is 15% of 200?")!.template).toBe("percentage");
  });

  // --- Adversarial pass findings, each a confident wrong answer, pinned ---

  it("ADV-1: a stated RATE is a percentage, not a head count", () => {
    // Was 75% ("30" read as 30 people out of 40).
    expect(
      solveWordProblem("In a survey of 40 people, 30% said they liked chocolate. What is the percentage of people who like chocolate?")
    ).toBeNull();
  });

  it("ADV-2: thousands commas in counts survive the clause split", () => {
    // Was 5% — "2,500" split into "2" and "500 said…".
    const r = solveWordProblem(
      "In a survey of 10,000 people, 2,500 said they liked chocolate. What is the percentage of people who like chocolate?"
    )!;
    expect(r.answer).toBe("25%");
    expect(r.steps.join(" ")).toContain("2,500 said");
  });

  it("ADV-3: a compound category must match EVERY word — no best-partial theft", () => {
    // Was 40% (the CHOCOLATE ice cream count) for a vanilla ice cream question.
    expect(
      solveWordProblem(SURVEY.replace(/chocolate ice cream\?$/, "vanilla ice cream?"))
    ).toBeNull();
  });

  it("ADV-4: 'likely' is not 'like' — an adverb never becomes a category", () => {
    // Was 25%, counting "5 said it was likely they would come back".
    expect(
      solveWordProblem("In a survey of 20 people, 5 said it was likely they would come back. What is the percentage of people who like the store?")
    ).toBeNull();
  });

  it("ADV-5: the question is the LAST percent sentence, not a statement about one", () => {
    // Was 40% (chocolate's count) for a vanilla question, because a statement
    // sentence beginning "The percentage of people who liked chocolate…"
    // matched first.
    const r = solveWordProblem(
      "The percentage of people who liked chocolate was unknown. In a survey of 20 people, 8 said they liked chocolate and 12 said they liked vanilla. What is the percentage of people who liked vanilla?"
    )!;
    expect(r.answer).toBe("60%");
    expect(r.steps.join(" ")).toContain("12 said they liked vanilla");
  });

  it("ADV-6: a clause with several numbers, or a stated range, cannot commit to a count", () => {
    // "8 out of every 10" is a rate (truth 80%) — was answered 40%.
    expect(
      solveWordProblem("In a survey of 20 people, 8 out of every 10 said they liked chocolate. What is the percentage of people who like chocolate?")
    ).toBeNull();
    // "between 5 and 8" states a range — was answered 40%.
    expect(
      solveWordProblem("In a survey of 20 people, between 5 and 8 people said they liked chocolate. What is the percentage of people who like chocolate?")
    ).toBeNull();
  });
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
