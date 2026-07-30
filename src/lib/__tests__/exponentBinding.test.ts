// An exponent extends to the atom after it, and no further.
//
// solve.ts read `2^2x` as 2^(2*x) while mathParse.ts read it as (2^2)*x — the same
// text meaning two different things in two parts of one product. That was recorded as
// a cosmetic inconsistency, and it was not: the same fault made `r^2 h` parse as
// r^(2*h), which for r = 3, h = 2 evaluates to **81** where the answer is 18.
//
// There were two causes, and both had to go:
//
//   1. Implicit multiplication was formed inside atom()'s NUMBER branch, so a number
//      followed by a letter became a product ANYWHERE — including inside an exponent,
//      which is the one place it must not. It now lives in term(), and the exponent
//      parses a single atom.
//
//   2. The parser DELETED all whitespace before reading anything, so adjacent names
//      were glued into one: `pi r` became a variable called "pir", `y z` became "yz".
//      `pi r^2 h` — the volume of a cylinder — was therefore "pir" raised to (2*h).
//      Whitespace now separates factors.
//
// This is not a disputed convention, which is why it was fixed rather than refused the
// way `1/2x` was: a typeset superscript shows exactly how far the exponent reaches.

import { parseExpr, format, evalAst, freeVars } from "../solve";
import { parseMathAst } from "../mathParse";

const P = (s: string): string => format(parseExpr(s));
const V = (s: string, vars: Record<string, number>): number => evalAst(parseExpr(s), vars);

describe("the exponent takes one atom", () => {
  test.each([
    ["2^2x", "2^2*x"],
    ["x^2y", "x^2*y"],
    ["r^2 h", "r^2*h"],
    ["x^2y^3", "x^2*y^3"],
    ["e^2x", "e^2*x"],
    ["x^2 y z", "x^2*y*z"],
    ["sin(x)^2 y", "sin(x)^2*y"],
    ["x^n y", "x^n*y"],
  ])("%s parses as %s", (input, want) => {
    expect(P(input)).toBe(want);
  });

  test("the number that made this a wrong answer, not a formatting quibble", () => {
    // r^2 h with r = 3, h = 2 is 9*2 = 18. It used to be 3^(2*2) = 81.
    expect(V("r^2 h", { r: 3, h: 2 })).toBe(18);
    expect(V("r^2*h", { r: 3, h: 2 })).toBe(18);
    expect(V("2^2x", { x: 3 })).toBe(12);      // (2^2)*3, not 2^6 = 64
    expect(V("x^2y", { x: 2, y: 5 })).toBe(20); // (2^2)*5, not 2^10
  });

  test("explicit brackets are respected, in both directions", () => {
    expect(V("2^(2*x)", { x: 3 })).toBe(64);
    expect(V("(2^2)*x", { x: 3 })).toBe(12);
    expect(P("2^(2*x)")).toBe("2^(2*x)");
  });

  test("right-associativity is preserved", () => {
    // 2^3^2 is 2^(3^2) = 512, not (2^3)^2 = 64. Recursing into the exponent for a
    // trailing ^ is what keeps this, and it is easy to lose while changing the rest.
    expect(V("2^3^2", {})).toBe(512);
    expect(V("2^2^3", {})).toBe(256);
    expect(V("x^2^2", { x: 2 })).toBe(16);
  });

  test("signs in and around the exponent", () => {
    expect(V("x^-1", { x: 4 })).toBe(0.25);
    expect(V("x^-2", { x: 2 })).toBe(0.25);
    expect(V("-x^2", { x: 3 })).toBe(-9);  // -(x^2), the standard reading
    expect(V("2^-1x", { x: 6 })).toBe(3);  // (2^-1)*6
  });
});

describe("whitespace separates factors instead of vanishing", () => {
  test.each([
    ["y z", "y*z"],
    ["pi r", "pi*r"],
    ["2 x", "2*x"],
    ["x y", "x*y"],
    ["a b c", "a*b*c"],
    ["pi r^2 h", "pi*r^2*h"],
  ])("%s parses as %s", (input, want) => {
    expect(P(input)).toBe(want);
  });

  test("the variables are the ones the user typed", () => {
    // `pi r` used to be a single variable called "pir", so the expression had one
    // unknown with a name nobody wrote.
    expect(freeVars(parseExpr("pi r^2 h")).sort()).toEqual(["h", "r"]);
    expect(freeVars(parseExpr("y z")).sort()).toEqual(["y", "z"]);
    expect(freeVars(parseExpr("a b c")).sort()).toEqual(["a", "b", "c"]);
  });

  test("a multi-character name with NO space is still one name", () => {
    // The fix must not shatter legitimate identifiers.
    expect(freeVars(parseExpr("x2"))).toEqual(["x2"]);
    expect(freeVars(parseExpr("Vd"))).toEqual(["Vd"]);
    expect(freeVars(parseExpr("v_max"))).toEqual(["v_max"]);
    expect(P("x2 + 1")).toBe("x2 + 1");
  });

  test("the cylinder volume evaluates correctly", () => {
    // pi r^2 h with r = 2, h = 3 is 12*pi = 37.699.
    expect(V("pi r^2 h", { r: 2, h: 3 })).toBeCloseTo(12 * Math.PI, 9);
  });

  test("juxtaposition against brackets and functions", () => {
    expect(V("2(x+1)", { x: 3 })).toBe(8);
    expect(V("(x+1)(x+2)", { x: 1 })).toBe(6);
    expect(V("3sin(x)", { x: 0 })).toBe(0);
    expect(V("2 (x+1)", { x: 3 })).toBe(8);
  });
});

describe("a bare function name is a missing bracket, not a variable", () => {
  test.each(["sin x", "cos x", "exp x", "ln x", "sqrt x", "tan x"])("%s is refused", (input) => {
    // Before whitespace mattered this parsed as one variable called "sinx"; after,
    // it would have become sin*x — a product with a variable named "sin", which is
    // the kind of nonsense that produces a plausible answer.
    expect(() => parseExpr(input)).toThrow(/is a function/);
    expect(() => parseExpr(input)).toThrow(/needs brackets/);
  });

  test("with brackets it works, and a non-function name is still a variable", () => {
    expect(V("sin(x)", { x: 0 })).toBe(0);
    expect(freeVars(parseExpr("sinh_ratio"))).toEqual(["sinh_ratio"]);
    expect(freeVars(parseExpr("s"))).toEqual(["s"]);
  });
});

describe("the two parsers now agree", () => {
  test("neither reads 2^2x as 2^(2x) any more", () => {
    // The whole point. mathParse.ts was always right; solve.ts was the odd one out,
    // and was left alone in v2.45.0 out of caution about re-reading existing
    // documents. Measuring showed the old reading was simply wrong, not merely
    // different.
    for (const text of ["2^2x", "r^2 h", "x^2y", "pi r^2 h", "2^3^2"]) {
      expect(() => parseExpr(text)).not.toThrow();
      expect(() => parseMathAst(text)).not.toThrow();
    }
  });

  test("every shipped formula still typesets", () => {
    // mathParse.ts must handle EVERY entry, because it is what turns these into Word
    // equations. This is the universal claim, and it is true.
    const { FORMULA_LIBRARY } = require("../formulaLibrary");
    let checked = 0;
    for (const group of FORMULA_LIBRARY) {
      for (const item of group.formulas) {
        expect(() => parseMathAst(item.expr)).not.toThrow();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test("the ALGEBRAIC library formulas evaluate correctly in solve.ts", () => {
    // A curated list rather than a sweep, on purpose. Many library entries are display
    // notation that an expression evaluator has no business accepting — summations with
    // three arguments, factorials, integrals — so a filtered sweep would either fail on
    // those or need a filter loose enough to hide a real failure. Naming the algebraic
    // ones states exactly what is covered, and these are the shapes the exponent bug
    // actually lived in: an implicit product with an exponent in it.
    const cases: Array<[string, Record<string, number>, number]> = [
      ["pi r^2 h", { r: 2, h: 3 }, Math.PI * 4 * 3],                    // cylinder
      ["(1/3) pi r^2 h", { r: 3, h: 4 }, (Math.PI * 9 * 4) / 3],        // cone
      ["(4/3) pi r^3", { r: 2 }, (4 / 3) * Math.PI * 8],                // sphere
      ["I^2 R", { I: 3, R: 2 }, 18],                                    // power dissipated
      ["sqrt(a^2 + b^2)", { a: 3, b: 4 }, 5],                           // Pythagoras
      ["(y_2 - y_1)/(x_2 - x_1)", { y_2: 4, y_1: 1, x_2: 3, x_1: 1 }, 1.5], // slope
    ];
    for (const [expr, vars, want] of cases) {
      const got = V(expr, vars);
      expect({ expr, close: Math.abs(got - want) < 1e-9 }).toEqual({ expr, close: true });
    }
  });

  test("the cylinder and cone volumes are the specific cases that were wrong", () => {
    // V = pi r^2 h and V = (1/3) pi r^2 h, both shipped, both previously parsed by
    // solve.ts as a variable "pir" raised to the power (2*h).
    expect(V("pi r^2 h", { r: 1, h: 1 })).toBeCloseTo(Math.PI, 12);
    expect(V("(1/3) pi r^2 h", { r: 3, h: 4 })).toBeCloseTo((1 / 3) * Math.PI * 9 * 4, 9);
    expect(V("I^2 R", { I: 3, R: 2 })).toBe(18);
  });
});
