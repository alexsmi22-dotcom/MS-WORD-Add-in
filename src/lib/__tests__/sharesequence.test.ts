// Successive-share word problems.
//
// The motivating case, reported from real use: "A pie is divided to 100 guest.
// Guest 1 gets 1%, guest 2 gets 2% of what's left, and so on. Who gets the
// largest piece of pie?" — Solve returned nothing at all.
//
// The answer is deliberately counter-intuitive (guest 10, not guest 1 and not
// guest 100), so the derivation matters as much as the number. Every expected
// value here is derived independently below, not copied from the implementation.

import { parseShareProblem, solveShares } from "../sharesequence";
import { solveWordProblem } from "../wordproblem";

const PIE =
  "A pie is divided to 100 guest. Guest 1 gets 1%, guest 2 gets 2% of what's left, and so on. Who gets the largest piece of pie?";

/** Independent reference: straight simulation of the stated rule. */
function referenceShares(n: number): number[] {
  const out: number[] = [];
  let remaining = 1;
  for (let k = 1; k <= n; k++) {
    const piece = remaining * (k / 100);
    out.push(piece);
    remaining -= piece;
  }
  return out;
}

describe("parseShareProblem", () => {
  test("recognises the reported problem", () => {
    const p = parseShareProblem(PIE);
    expect(p).not.toBeNull();
    expect(p!.n).toBe(100);
    expect(p!.ofRemainder).toBe(true);
    expect(p!.question).toBe("largest");
    expect(p!.subject).toBe("pie");
    expect(p!.recipient).toBe("guest");
  });

  test("handles the 'of the original' variant", () => {
    const p = parseShareProblem(
      "A prize is split among 10 winners. Winner 1 gets 1%, winner 2 gets 2%, and so on. Who gets the largest share?",
    );
    expect(p).not.toBeNull();
    expect(p!.ofRemainder).toBe(false);
  });

  test("recognises a 'how much is left' question", () => {
    const p = parseShareProblem(
      "A cake is divided among 20 people. Person 1 takes 1%, person 2 takes 2% of what remains, and so on. How much is left?",
    );
    expect(p).not.toBeNull();
    expect(p!.question).toBe("remaining");
  });

  test("returns null rather than guessing on an unrelated problem", () => {
    for (const t of [
      "What is 15% of 240?",
      "A train travels 120 km at 60 km/h. How long does it take?",
      "A pie is delicious.",
      "",
      "Guests arrived at eight.",
    ]) {
      expect({ t, parsed: parseShareProblem(t) !== null }).toEqual({ t, parsed: false });
    }
  });
});

describe("solveShares — the arithmetic", () => {
  const p = parseShareProblem(PIE)!;
  const sol = solveShares(p);
  const ref = referenceShares(100);

  test("every share matches an independent simulation", () => {
    expect(sol.pieces.length).toBe(100);
    for (let i = 0; i < 100; i++) expect(sol.pieces[i]).toBeCloseTo(ref[i], 15);
  });

  test("the largest share is guest 10", () => {
    // Independently: argmax of the reference simulation.
    let best = 0;
    for (let i = 1; i < ref.length; i++) if (ref[i] > ref[best]) best = i;
    expect(best + 1).toBe(10);
    expect(sol.largest.k).toBe(10);
  });

  test("guest 10's share is 6.2816% of the pie", () => {
    expect(sol.largest.fraction * 100).toBeCloseTo(6.2816, 4);
  });

  test("the peak is a real peak — both neighbours are smaller", () => {
    expect(sol.pieces[9]).toBeGreaterThan(sol.pieces[8]);
    expect(sol.pieces[9]).toBeGreaterThan(sol.pieces[10]);
  });

  test("the ratio test agrees with the argmax", () => {
    // P(k+1)/P(k) = ((k+1)/k)(1 - k/100) crosses 1 at k* = (-1 + sqrt(401))/2.
    const kStar = (-1 + Math.sqrt(401)) / 2;
    expect(kStar).toBeCloseTo(9.5125, 4);
    expect(Math.ceil(kStar)).toBe(sol.largest.k);
  });

  test("shares are strictly increasing up to the peak and strictly decreasing after", () => {
    for (let i = 1; i < 9; i++) expect(sol.pieces[i]).toBeGreaterThan(sol.pieces[i - 1]);
    for (let i = 10; i < 60; i++) expect(sol.pieces[i]).toBeLessThan(sol.pieces[i - 1]);
  });

  test("nothing is created — the shares plus the remainder equal the whole", () => {
    const total = sol.pieces.reduce((a, b) => a + b, 0);
    expect(total + sol.remaining).toBeCloseTo(1, 12);
  });

  test("guest 100 takes everything left, so the remainder is zero", () => {
    expect(sol.remaining).toBeCloseTo(0, 12);
  });

  test("the 'of the original' variant peaks at the last recipient instead", () => {
    const q = parseShareProblem(
      "A prize is split among 10 winners. Winner 1 gets 1%, winner 2 gets 2%, and so on. Who gets the largest share?",
    )!;
    const s = solveShares(q);
    expect(s.largest.k).toBe(10);
    expect(s.pieces[9]).toBeCloseTo(0.1, 12);
  });
});

describe("solveShares — the explanation", () => {
  const sol = solveShares(parseShareProblem(PIE)!);

  test("the answer names the guest and the size", () => {
    expect(sol.answer).toContain("Guest 10");
    expect(sol.answer).toContain("6.2816%");
  });

  test("the work shows the recurrence, the ratio test and the root", () => {
    const work = sol.steps.join("\n");
    expect(work).toContain("P(k) = (k/100)");
    expect(work).toContain("P(k+1) / P(k)");
    expect(work).toContain("k² + k − 100 = 0");
    expect(work).toContain("9.5125");
  });

  test("the work checks both neighbours, so the peak is shown not asserted", () => {
    const work = sol.steps.join("\n");
    expect(work).toContain("guest 9");
    expect(work).toContain("guest 11");
  });

  test("it states that the values are exact, not estimated", () => {
    expect(sol.caveats.join(" ")).toMatch(/exactly|not estimated/i);
  });
});

describe("solveWordProblem routes the reported problem", () => {
  test("the exact text the user typed now returns an answer", () => {
    const r = solveWordProblem(PIE);
    expect(r).not.toBeNull();
    expect(r!.template).toBe("successive shares");
    expect(r!.answer).toContain("Guest 10");
    expect(r!.steps.length).toBeGreaterThan(5);
    expect(r!.equation).toContain("P(k)");
  });

  test("it wins over the percentage template, which would answer a smaller question", () => {
    // "1%" and "2%" would otherwise match tryPercentage first.
    const r = solveWordProblem(PIE);
    expect(r!.template).not.toBe("percentage");
  });

  test("ordinary percentage problems still route to the percentage template", () => {
    const r = solveWordProblem("What is 15% of 240?");
    expect(r).not.toBeNull();
    expect(r!.template).not.toBe("successive shares");
  });
});
