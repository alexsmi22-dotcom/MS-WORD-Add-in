// The typed-number grammar, and the uncertainty parser that reads it.
//
// The bug: the uncertainty parser used the character class `[\d.eE+]+`, which
// allows `+` but not `-`. So `a = 1e-3 ± 1e-4` did not match the anchored line
// pattern, the line was SILENTLY DISCARDED, and the pane then printed
// `Couldn't evaluate: Unknown variable "a"` — blaming the formula for a variable
// the user could see they had defined two lines above. `1e+3` worked, which is
// what made it look like scientific notation was supported.
//
// Two things are tested here, and the second matters as much as the first:
//
//   1. The reported symptom is gone.
//   2. The WIDER grammar does not admit new nonsense. Allowing a leading minus
//      on both captures means `a = 5 ± -0.1` now matches where it used to be
//      rejected by accident, and uncertainty propagation squares sigma — so a
//      negative uncertainty would vanish into a plausible-looking answer. Five
//      rounds of review this session found defects in the previous round's
//      repairs; a too-permissive replacement guard is that pattern exactly.

import { NUM_DECIMAL, NUM_WITH_FRACTION, NUM_DECIMAL_ONLY } from "../numgrammar";
import { statVarLineProblem, statVars } from "../uncertaintyParse";

const anchored = (pat: string): RegExp => new RegExp(`^${pat}$`);

describe("NUM_DECIMAL matches what a person types and nothing else", () => {
  const re = anchored(NUM_DECIMAL);

  test.each([
    "1", "-1", "+1", "0", "-0",
    "1.5", "-1.5", "2.", ".5", "-.5",
    "1e3", "1E3", "1e-3", "1e+3", "1E-9", "-2.5e-12", "+2.5E+12",
  ])("accepts %s", (s) => {
    expect(re.test(s)).toBe(true);
    expect(Number.isFinite(parseFloat(s))).toBe(true);
  });

  test.each([
    "1.2.3",   // parseFloat silently read this as 1.2
    "1e", "e3", ".", "-", "+", "",
    "1e3.5",   // a fractional exponent is not a literal
    "1 2", "1,5", "0x10", "1_000",
    "NaN", "Infinity", "-Infinity",  // deliberately refused elsewhere too
  ])("refuses %s", (s) => {
    expect(re.test(s)).toBe(false);
  });

  test("the anchored helper agrees and trims surrounding space", () => {
    expect(NUM_DECIMAL_ONLY.exec("  -1e-3 ")?.[1]).toBe("-1e-3");
    expect(NUM_DECIMAL_ONLY.test("1.2.3")).toBe(false);
  });
});

describe("NUM_WITH_FRACTION is NUM_DECIMAL plus an exact-fraction tail", () => {
  const re = anchored(NUM_WITH_FRACTION);

  test.each(["1/2", "-1/2", "3 / 4", "1.5/2", "1e-3/7", "1/-2"])("accepts %s", (s) => {
    expect(re.test(s)).toBe(true);
  });

  test.each(["1/", "/2", "1/2.5", "1/2/3"])("refuses %s", (s) => {
    expect(re.test(s)).toBe(false);
  });

  test("every plain decimal is still accepted", () => {
    for (const s of ["1", "-1e-3", ".5", "2."]) expect(re.test(s)).toBe(true);
  });
});

describe("the uncertainty line parser", () => {
  test("scientific notation with a negative exponent is accepted — the reported bug", () => {
    // This is verbatim what produced `Unknown variable "a"`.
    expect(statVarLineProblem("a = 1e-3 ± 1e-4")).toBeNull();
    expect(statVarLineProblem("b = 20 ± 0.2")).toBeNull();
    expect(statVarLineProblem("c = 5 ± 0.05")).toBeNull();
  });

  test("all three ± spellings work, with or without space", () => {
    for (const sep of ["±", "+/-", "+-"]) {
      expect(statVarLineProblem(`a = 1e-3 ${sep} 1e-4`)).toBeNull();
      expect(statVarLineProblem(`a = 1e-3${sep}1e-4`)).toBeNull();
    }
  });

  test("a negative uncertainty is refused ON PURPOSE, not by accident", () => {
    // The old character class rejected this only because it omitted the minus.
    // Widening the grammar to fix the real bug would have let it through, and
    // propagation squares sigma, so it would have produced a plausible number.
    const p = statVarLineProblem("a = 5 ± -0.1");
    expect(p).toBeTruthy();
    expect(p).toMatch(/negative uncertainty/);
    expect(p).toMatch(/magnitude/);
    // A zero uncertainty is legitimate — an exactly known quantity.
    expect(statVarLineProblem("a = 5 ± 0")).toBeNull();
  });

  test("a negative VALUE is fine — only the uncertainty is a magnitude", () => {
    expect(statVarLineProblem("dT = -1.5e-3 ± 2e-5")).toBeNull();
  });

  test("a malformed line is named, not silently dropped", () => {
    for (const line of ["a = 1.2.3 ± 0.1", "a = 5", "a ± 5", "= 5 ± 1", "a = five ± 1"]) {
      expect({ line, p: Boolean(statVarLineProblem(line)) }).toEqual({ line, p: true });
    }
  });

  test("a blank line is not a problem", () => {
    expect(statVarLineProblem("")).toBeNull();
    expect(statVarLineProblem("   ")).toBeNull();
  });

  test("statVars agrees with statVarLineProblem on every line", () => {
    // The two must not disagree: one decides what the user is told, the other
    // decides what is computed. A line reported as fine but not collected would
    // reproduce the original bug from the other direction.
    const lines = [
      "a = 1e-3 ± 1e-4", "b = 20 ± 0.2", "c = -5 ± 0.05",
      "d = 5 ± -0.1", "e = 1.2.3 ± 0.1", "f = 5", "g = 0 ± 0",
    ];
    const collected = statVars(lines.join("\n"));
    for (const line of lines) {
      const name = line.split("=")[0].trim();
      const fine = statVarLineProblem(line) === null;
      expect({ line, fine, collected: name in collected }).toEqual({ line, fine, collected: fine });
    }
  });

  test("a negative uncertainty is not collected, so it cannot reach propagation", () => {
    expect(statVars("a = 5 ± -0.1")).toEqual({});
    expect(statVars("a = 5 ± 0.1")).toEqual({ a: { value: 5, uncertainty: 0.1 } });
  });

  test("semicolons separate variables as well as newlines", () => {
    expect(statVars("a = 1 ± 0.1; b = 2 ± 0.2")).toEqual({
      a: { value: 1, uncertainty: 0.1 },
      b: { value: 2, uncertainty: 0.2 },
    });
  });
});
