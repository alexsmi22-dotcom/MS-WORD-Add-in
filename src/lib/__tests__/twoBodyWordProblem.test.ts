// The distance/rate/time template used to answer TWO-body problems with one
// body's speed.
//
//   "Two trains 300 km apart travelling toward each other at 60 and 90 km/h.
//    When do they meet?"      correct: 2 h
//   What it said:             3.33 h, with the working "300 ÷ 90" attached.
//
// Reworded, it said 5 h instead — `exec` returns the FIRST match and which speed
// appears first is arbitrary. A fabricated answer carrying its own derivation is
// the worst thing this product can emit, so these tests come in two halves:
// the closing-speed case is now solved, and anything the template cannot
// represent is REFUSED rather than approximated.

import { solveWordProblem } from "../wordproblem";

const answer = (q: string): string | null => solveWordProblem(q)?.answer ?? null;

describe("two bodies approaching: the speeds add", () => {
  test("the case that used to be wrong", () => {
    // 300 km closing at 60 + 90 = 150 km/h -> 2 hours.
    expect(
      answer("Two trains leave stations 300 km apart travelling toward each other at 60 and 90 km/h. When do they meet?"),
    ).toBe("2");
  });

  test("with the unit written on both speeds", () => {
    // 120 miles closing at 30 mph -> 4 hours.
    expect(answer("Two ships 120 miles apart sail toward each other at 10 mph and 20 mph. When do they meet?")).toBe("4");
  });

  test("the working shows the combined rate, not one body's", () => {
    const r = solveWordProblem(
      "Two ships 120 miles apart sail toward each other at 10 mph and 20 mph. When do they meet?",
    );
    expect(r).not.toBeNull();
    expect(r!.steps.join(" ")).toContain("combined rate = 10 + 20 = 30");
    expect(r!.caveats.join(" ")).toMatch(/speeds add/);
  });

  test("it does not silently use one speed", () => {
    // The old answers were 300/90 = 3.333333 and 300/60 = 5.
    const a = answer("Two trains leave stations 300 km apart travelling toward each other at 60 and 90 km/h. When do they meet?");
    expect(a).not.toBe("3.333333");
    expect(a).not.toBe("5");
  });
});

describe("two bodies separating: the speeds also add", () => {
  test("opposite directions", () => {
    // 50 km apart at 8 + 12 = 20 km/h -> 2.5 hours.
    expect(
      answer("Two runners start together and run in opposite directions at 8 km/h and 12 km/h. How long until they are 50 km apart?"),
    ).toBe("2.5");
  });
});

describe("the one-body template still works", () => {
  test("distance and rate give time", () => {
    expect(answer("A car travels 300 km at 90 km/h. How long does it take?")).toBe("3.333333");
  });

  test("rate and time give distance", () => {
    expect(answer("A train travels at 60 mph for 3 hours. How far does it go?")).toBe("180");
  });

  test("distance and time give speed", () => {
    expect(answer("A car covers 240 miles in 4 hours. What speed did it average?")).toBe("60");
  });
});

describe("what it refuses rather than guesses", () => {
  test("two speeds with no stated geometry", () => {
    // Without "toward each other" or "opposite directions" there is nothing to
    // say whether the speeds add, subtract, or are unrelated.
    expect(answer("A cyclist rides at 20 km/h and a runner at 10 km/h over 30 km. How long?")).toBeNull();
  });

  test("two distances", () => {
    expect(answer("A car drives 100 km then 200 km at 50 km/h. How long does it take?")).toBeNull();
  });

  test("two times", () => {
    expect(answer("A train runs for 2 hours then 3 hours at 60 mph. How far?")).toBeNull();
  });

  test("a closing problem missing its distance is refused, not invented", () => {
    expect(answer("Two cars drive toward each other at 40 km/h and 60 km/h. When do they meet?")).toBeNull();
  });
});

describe("a speed is not also a distance", () => {
  test("'90 km/h' does not count as a distance in km", () => {
    // DIST_UNITS contains "km", so without a guard every speed counted as a
    // distance too and ordinary one-body questions were refused outright.
    expect(answer("A car travels 300 km at 90 km/h. How long does it take?")).not.toBeNull();
  });

  test("'20 m/s' does not count as a distance in m", () => {
    expect(answer("A runner covers 100 meters at 20 m/s. How long does it take?")).not.toBeNull();
  });
});
