// The word-problem translator, against VERBATIM textbook problems.
//
// WHY THESE EXACT SENTENCES. A user reported "solve is not working right — I
// tried multiple questions and it did not respond", and pointed at two sources:
// a tricky-maths-questions list and LibreTexts "1.20: Word Problems for Linear
// Equations". Driving the shipped bundle against the eleven worked examples on
// that page measured **0 of 15 solved** — including the module's own documented
// "a number …" template, which was refusing its canonical example.
//
// So the acceptance list is not invented: it is the textbook's own wording,
// copied character for character. A parser tested on sentences its author wrote
// is tested on sentences its author already knew how to parse.
//
// THE SECOND LESSON IS IN THE FAILURES. The first working version answered 2b
// with −2.2 (truth: 9) and 2e with −0.75 (truth: 8), because the inverting
// phrases were resolved before the unknown was substituted. A WRONG ANSWER is
// the one outcome this module exists to prevent — every inversion below is
// pinned for that reason, not for coverage.

import { solveWordProblem } from "../wordproblem";

/** Solves and returns the numeric answer, or null if the parser refused. */
function answer(text: string): number | null {
  const r = solveWordProblem(text);
  return r ? r.value : null;
}

/** The equation the parser says it read — shown to the user, so pinned here. */
function equationOf(text: string): string | undefined {
  return solveWordProblem(text)?.equation;
}

describe("LibreTexts 1.20, Example 18.2 — direct equation problems", () => {
  const CASES: [string, string, number][] = [
    ["2a", "Five times an unknown number is equal to 60", 12],
    ["2b", "If 5 is subtracted from twice an unknown number, the difference is 13", 9],
    ["2c", "A number subtracted from 9 is equal to 2 times the number", 3],
    [
      "2d",
      "Multiply an unknown number by five is equal to adding twelve to the unknown number",
      3,
    ],
    [
      "2e",
      "Adding nine to a number gives the same result as subtracting seven from three times the number",
      8,
    ],
  ];

  for (const [label, text, want] of CASES) {
    test(`${label}: ${text}`, () => {
      expect({ label, got: answer(text) }).toEqual({ label, got: want });
    });
  }
});

describe("the inverting phrases, which produce a WRONG ANSWER when reversed", () => {
  // "5 less than x" is x - 5. Reversed it is 5 - x, which solves happily to a
  // different number and looks entirely plausible.
  test("'subtracted from' inverts, and the equation shown proves the order", () => {
    const eq = equationOf("If 5 is subtracted from twice an unknown number, the difference is 13");
    expect(eq).toBe("(2*n) - 5 = 13");
    expect(eq).not.toContain("5 - ");
  });

  test("'subtracting N from M' inverts", () => {
    const eq = equationOf(
      "Adding nine to a number gives the same result as subtracting seven from three times the number",
    );
    expect(eq).toBe("n + 9 = (3*n) - 7");
  });

  test("'a number subtracted from 9' puts the number second", () => {
    expect(equationOf("A number subtracted from 9 is equal to 2 times the number")).toBe("9 - n = (2*n)");
  });

  test("'less than' still inverts", () => {
    expect(answer("5 less than a number is 12")).toBe(17);
    expect(equationOf("5 less than a number is 12")).toBe("n - 5 = 12");
  });
});

describe("the question sentence is dropped before translating", () => {
  // "A number increased by 7 is 22. What is the number?" used to translate to
  // `n + 7 = 22. n?` and refuse. The template was DOCUMENTED as supported and
  // was measured refusing its own canonical example.
  test("a trailing question does not break the sentence", () => {
    expect(answer("A number increased by 7 is 22. What is the number?")).toBe(15);
    expect(answer("A number decreased by 2 is 63. What is the number?")).toBe(65);
  });

  test("and the same sentence without the question still works", () => {
    expect(answer("A number increased by 7 is 22")).toBe(15);
  });
});

describe("running totals — the shape a real user brought", () => {
  const TRAIN =
    "There were some people on a train.\n" +
    "19 people get off the train at the first stop.\n" +
    "17 people get on the train.\n" +
    "Now there are 63 people on the train.\n" +
    "How many people were on the train to begin with?";

  test("the train problem", () => {
    expect(answer(TRAIN)).toBe(65);
  });

  test("it shows the equation it built, in the order the events were written", () => {
    expect(equationOf(TRAIN)).toBe("x - 19 + 17 = 63");
  });

  test("the order of the events matters and is respected", () => {
    // Same numbers, opposite events: 63 - 17 + 19 = 65 either way for a pure
    // sum, so use asymmetric numbers to prove the signs are read per-event.
    const a = answer(
      "There were some people on a bus. 10 people get off. 4 people get on. Now there are 20 people on the bus.",
    );
    expect(a).toBe(26);
  });

  test("it REFUSES when no unknown start is stated", () => {
    // Without "some", there is nothing to solve for and a number could be
    // conjured from thin air.
    expect(
      answer("19 people get off the train. 17 people get on. Now there are 63 people on the train."),
    ).toBeNull();
  });

  test("it REFUSES when there is no final total", () => {
    expect(answer("There were some people on a train. 19 people get off the train.")).toBeNull();
  });
});

describe("it refuses rather than guesses", () => {
  // These are the LibreTexts problems that need a concept the translator does
  // not have — a percentage increase, a work rate, a partition, a proportion, a
  // perimeter. Refusing is the CORRECT behaviour today, and this test exists so
  // that if any of them starts answering, it does so deliberately and with a
  // test written for it rather than by accident.
  const OUT_OF_SCOPE = [
    "Due to inflation, the price of a loaf of bread has increased by 5%. How much does the loaf of bread cost now, when its price was $2.40 last year?",
    "To complete a job, three workers get paid at a rate of $12 per hour. If the total pay for the job was $180, then how many hours did the three workers spend on the job?",
    "A farmer cuts a 300 foot fence into two pieces of different sizes. The longer piece should be four times as long as the shorter piece. How long are the two pieces?",
    "If 4 blocks weigh 28 ounces, how many blocks weigh 70 ounces?",
    "If a rectangle has a length that is three more than twice the width and the perimeter is 20 in, what are the dimensions of the rectangle?",
    "The perimeter of an equilateral triangle is 60 meters. How long is each side?",
  ];

  for (const text of OUT_OF_SCOPE) {
    test(`refuses: ${text.slice(0, 52)}…`, () => {
      expect(answer(text)).toBeNull();
    });
  }

  test("and refuses a question with no mathematics in it at all", () => {
    expect(answer("What is the capital of France?")).toBeNull();
    expect(answer("How many moles are in 18 grams of water?")).toBeNull();
  });
});

describe("every translated answer shows its equation", () => {
  // The honesty constraint that makes widening the vocabulary safe: a
  // misreading produces a visibly wrong equation beside the answer, which a
  // reader catches. An answer with no equation would hide it.
  const SOLVABLE = [
    "Five times an unknown number is equal to 60",
    "A number increased by 7 is 22. What is the number?",
    "There were some people on a train. 19 people get off the train. 17 people get on the train. Now there are 63 people on the train.",
  ];
  for (const text of SOLVABLE) {
    test(`carries an equation: ${text.slice(0, 40)}…`, () => {
      const r = solveWordProblem(text);
      expect(r).not.toBeNull();
      expect(r!.equation && r!.equation.length).toBeGreaterThan(2);
      expect(r!.caveats.length).toBeGreaterThan(0);
    });
  }
});
