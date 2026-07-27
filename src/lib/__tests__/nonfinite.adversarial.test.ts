// What happens when a constant folds to something that is not a real number.
//
// The sweep that produced this file fed roughly forty hostile strings to every
// engine in Solve. Nothing hung, nothing threw, and nothing returned a wrong
// answer — but two results were confusing in the same way, and for the same
// underlying reason: the parser and simplifier happily produce NaN and Infinity
// as ordinary values, and downstream code then reports them as though they were
// part of the user's question.
//
//   limit of sqrt(-1)   the working read "Limit of NaN as x → 0". Honest — it
//                       reported no answer — but it showed a folded artefact
//                       instead of what was typed, and never said why.
//   solve "NaN"         "NaN" is a legal identifier, so it became a VARIABLE,
//                       and the working read "1·NaN^1 + 0·NaN^0 = 0".
//
// Neither was a wrong answer, which is exactly why neither had been noticed.

import { limit } from "../analysis";
import { solveEquation } from "../solve";

describe("a limit of something that is not real-valued", () => {
  // 1e999 and -1e999 used to land here too. They are now rejected earlier, by
  // the PARSER, which refuses a literal it cannot represent — a better place to
  // catch it, because the user is told the literal is the problem rather than
  // being told something about a function they did not write. See
  // unbounded.adversarial.test.ts. What is left here is the case that only the
  // simplifier can find: an expression that parses fine and is not real-valued.
  const CASES: [string, RegExp][] = [
    ["sqrt(-1)", /not defined over the real numbers/],
    ["log(0)", /overflows to infinity as a CONSTANT/],
  ];
  for (const [src, why] of CASES) {
    it(`${src} is refused with a reason, not answered`, () => {
      const r = limit(src, "x", 0)!;
      expect(r.kind).toBe("undetermined");
      expect(r.caveats.join(" ")).toMatch(why);
    });
    it(`${src} echoes what was typed, not the folded constant`, () => {
      const r = limit(src, "x", 0)!;
      expect(r.expression).toBe(src);
      expect(r.steps.join(" ")).not.toMatch(/NaN|Infinity/);
    });
  }

  it("an overflowing literal is refused outright, at the parser", () => {
    expect(limit("1e999", "x", 0)).toBeNull();
    expect(limit("-1e999", "x", 0)).toBeNull();
  });

  it("an ordinary limit is untouched by any of this", () => {
    expect(limit("sin(x)/x", "x", 0)!.kind).toBe("finite");
    expect(limit("sin(x)/x", "x", 0)!.value).toBeCloseTo(1, 9);
    // 1/x still diverges in opposite directions rather than being swallowed.
    expect(limit("1/x", "x", 0)!.kind).toBe("does-not-exist");
  });
});

describe("NaN and Infinity are not variable names", () => {
  for (const src of ["NaN", "Infinity", "nan", "inf", "undefined"]) {
    it(`"${src}" is refused rather than solved for`, () => {
      expect(solveEquation(src)).toBeNull();
    });
  }
  it("a variable that merely CONTAINS one of those words is still fine", () => {
    // "infimum" starts with "inf"; the check is on the whole identifier.
    const r = solveEquation("infimum = 0");
    expect(r).not.toBeNull();
    expect(r!.variable).toBe("infimum");
  });
  it("ordinary equations are unaffected", () => {
    const r = solveEquation("x^2 - 4 = 0")!;
    expect(r.roots.map((x) => x.display).sort()).toEqual(["-2", "2"]);
  });
});
