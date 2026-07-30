// An identity hidden by cancellation, notation with two meanings, and hydrates.
//
//   B15 `cosh(x)^2 - sinh(x)^2 = 1` is an identity and returned 33 spurious roots.
//       A tolerance derived from the SIZE OF THE ANSWER cannot see catastrophic
//       cancellation, because cancellation is exactly the case where the answer is
//       tiny and the intermediates are enormous: at x = 18 both squares are about
//       1.1e15 and the computed difference carries 0.25 of rounding dust.
//   B11 `1/2x` read as `1/(2x)` in solve.ts and `(1/2)x` in mathParse.ts — the same
//       text meaning two different functions in two parts of one product.
//   C1  `parseFormula("CuSO4·5H2O")` stripped the hydrate dot, merging "O4" with the
//       following "5" into "O45", and returned O:46 instead of O:9.

import { solveEquation, evalAstScaled, parseExpr, format } from "../solve";
import { parseMathAst } from "../mathParse";
import { ambiguousImplicitProduct } from "../ambiguous";
import { parseFormula } from "../massspec";

// ---------------------------------------------------------------------------
// B15 — the intermediate magnitudes
// ---------------------------------------------------------------------------

describe("evalAstScaled reports what the evaluation passed through", () => {
  test("it sees the cancelling intermediates, not just the answer", () => {
    // cosh(18)^2 is about 1.1e15 while the expression's value is 1. A tolerance built
    // on the value alone is a billion times too tight to judge this.
    const r = evalAstScaled(parseExpr("cosh(x)^2 - sinh(x)^2"), { x: 18 });
    expect(r.value).toBeCloseTo(1, 0);
    expect(r.scale).toBeGreaterThan(1e14);
  });

  test("it agrees with evalAst on the value, for ordinary expressions", () => {
    const { evalAst } = require("../solve");
    for (const [e, x] of [["x^2 + 1", 3], ["sin(x)/x", 0.5], ["exp(x)", 2], ["1/x", 4]] as [string, number][]) {
      const ast = parseExpr(e);
      expect(evalAstScaled(ast, { x }).value).toBe(evalAst(ast, { x }));
    }
  });

  test("a well-conditioned expression has a scale close to its own value", () => {
    const r = evalAstScaled(parseExpr("x + 1"), { x: 4 });
    expect(r.scale).toBeCloseTo(5, 9);
  });
});

describe("B15: an identity hidden by cancellation is recognised", () => {
  test.each([
    "cosh(x)^2 - sinh(x)^2 = 1",
    "cosh(2*x) = cosh(x)^2 + sinh(x)^2",
    "tanh(x) = sinh(x)/cosh(x)",
    "sin(x)^2 + cos(x)^2 = 1",
    "sin(2*x) = 2*sin(x)*cos(x)",
    "exp(ln(x)) = x",
    "ln(exp(x)) = x",
    "(x+1)^2 = x^2+2*x+1",
    "x/x = 1",
    "(x-1)/(x-1) = 1",
  ])("%s", (eq) => {
    const r = solveEquation(eq);
    expect({ eq, method: r?.method, n: r?.roots.length }).toEqual({ eq, method: "identity", n: 0 });
  });

  test("and the near-identities are still NOT identities", () => {
    // The counterweight, and the reason the previous attempt at this was reverted:
    // the version that finally passed the cosh case also called `tan(x) = 2` and
    // `exp(x) = 2` identities, which would have made every equation vacuous.
    for (const eq of [
      "cosh(x)^2 - sinh(x)^2 = 1.0000001",
      "cosh(x)^2 - sinh(x)^2 = 2",
      "sin(x)^2 + cos(x)^2 = 1.0000001",
      "tan(x) = 2",
      "exp(x) = 2",
      "sin(x) = 0",
      "cos(x) = x",
      "x^2 = 4",
      "x^2 = x",
      "1/x = 2",
      "x*exp(x) = 1",
      "sin(x) = 0.5",
    ]) {
      const r = solveEquation(eq);
      expect({ eq, isIdentity: r?.method === "identity" }).toEqual({ eq, isIdentity: false });
    }
  });
});

// ---------------------------------------------------------------------------
// B11 — one reading or none
// ---------------------------------------------------------------------------

describe("B11: ambiguous implicit multiplication is refused by BOTH parsers", () => {
  test.each(["1/2x", "2/2x", "1/2(x+1)", "x/2y", "1/2 x", "3/4z", "a/2b"])(
    "%s is refused identically",
    (text) => {
      expect(ambiguousImplicitProduct(text)).toBeTruthy();
      expect(() => parseExpr(text)).toThrow(/ambiguous/);
      expect(() => parseMathAst(text)).toThrow(/ambiguous/);
    },
  );

  test("the message offers both readings, so the fix is one keystroke", () => {
    const msg = ambiguousImplicitProduct("1/2x")!;
    expect(msg).toMatch(/1\/\(2x\)/);
    expect(msg).toMatch(/\(1\/2\)x/);
    expect(msg).toMatch(/whichever you meant/);
  });

  test.each([
    "1/2*x", "1/(2*x)", "(1/2)*x", "1/2", "x/2", "1/2 + x", "sin(x)/2",
    "1/2e5", "1/2e-5", "1e-6", "2/4", "x/(2*y)",
  ])("%s is left alone", (text) => {
    expect(ambiguousImplicitProduct(text)).toBeNull();
    expect(() => parseExpr(text)).not.toThrow();
  });

  test("EXPONENTS are not refused, because their convention is settled", () => {
    // The first version of this also matched `^`, and that was wrong: an exponent
    // extends to the atom immediately after it, so `r^2 h` is unambiguously (r^2)*h.
    // Refusing it broke four SHIPPED formula-library entries — the volume of a
    // cylinder and a cone, power dissipated, and two-asset portfolio variance.
    for (const text of ["r^2 h", "I^2 R", "pi r^2 h", "x^2 y", "sigma_1^2 sigma_2^2"]) {
      expect({ text, amb: ambiguousImplicitProduct(text) }).toEqual({ text, amb: null });
    }
  });

  test("the shipped formula library still parses in full", () => {
    // The regression guard for the above. If a formula the product ships cannot be
    // parsed, the refusal has gone too far.
    const { FORMULA_LIBRARY } = require("../formulaLibrary");
    for (const group of FORMULA_LIBRARY) {
      for (const item of group.formulas) {
        expect({ label: item.label, amb: ambiguousImplicitProduct(item.expr) }).toEqual({
          label: item.label,
          amb: null,
        });
      }
    }
  });

  test("the two parsers now agree on every case, refusing or accepting together", () => {
    for (const text of [
      "1/2x", "2/2x", "x/2y", "1/2*x", "1/(2*x)", "(1/2)*x", "1/2", "x/2",
      "sin(x)/2", "1/2e5", "r^2 h", "x+1", "2*x",
    ]) {
      const solveRefused = (() => {
        try { parseExpr(text); return false; } catch { return true; }
      })();
      const mathRefused = (() => {
        try { parseMathAst(text); return false; } catch { return true; }
      })();
      expect({ text, solveRefused, mathRefused }).toEqual({ text, solveRefused, mathRefused: solveRefused });
    }
  });
});

// ---------------------------------------------------------------------------
// C1 — hydrates and bracket groups
// ---------------------------------------------------------------------------

describe("C1: parseFormula handles hydrates and bracket groups", () => {
  test.each([
    ["CuSO4·5H2O", { Cu: 1, S: 1, O: 9, H: 10 }],
    ["CuSO4.5H2O", { Cu: 1, S: 1, O: 9, H: 10 }],
    ["Na2CO3·10H2O", { Na: 2, C: 1, O: 13, H: 20 }],
    ["CaSO4·2H2O", { Ca: 1, S: 1, O: 6, H: 4 }],
    ["MgSO4·7H2O", { Mg: 1, S: 1, O: 11, H: 14 }],
  ] as [string, Record<string, number>][])("%s", (formula, want) => {
    // Before: the dot was deleted, so "O4" merged with the following "5" into "O45"
    // and CuSO4·5H2O came back as O:46.
    expect(parseFormula(formula)).toEqual(want);
  });

  test.each([
    ["Cr2(SO4)3·18H2O", { Cr: 2, S: 3, O: 30, H: 36 }],
    ["Al2(SO4)3", { Al: 2, S: 3, O: 12 }],
    ["K4[Fe(CN)6]", { K: 4, Fe: 1, C: 6, N: 6 }],
    ["((CH3)2CH)2O", { C: 6, H: 14, O: 1 }],
    ["K3[Fe(C2O4)3]·3H2O", { K: 3, Fe: 1, C: 6, O: 15, H: 6 }],
  ] as [string, Record<string, number>][])("%s", (formula, want) => {
    // Fixing the hydrate dot alone would have replaced one silent mis-parse with
    // another: brackets were stripped, so "(SO4)3" read as "SO43" and gave O:43.
    expect(parseFormula(formula)).toEqual(want);
  });

  test("flat formulas are unchanged — this is the path the only caller uses", () => {
    expect(parseFormula("C9H8O4")).toEqual({ C: 9, H: 8, O: 4 });
    expect(parseFormula("C22H24N2O8")).toEqual({ C: 22, H: 24, N: 2, O: 8 });
    expect(parseFormula("H2O")).toEqual({ H: 2, O: 1 });
    expect(parseFormula("C6H12O6")).toEqual({ C: 6, H: 12, O: 6 });
    expect(parseFormula("C8H10N4O2")).toEqual({ C: 8, H: 10, N: 4, O: 2 }); // caffeine
  });

  test("an unclosed bracket yields nothing rather than a guess", () => {
    // Adding up what was parsed before the formula stopped making sense would be a
    // guess presented as a count, and the count feeds monoisotopic mass.
    expect(parseFormula("CuSO4(")).toEqual({});
    expect(parseFormula("K4[Fe(CN)6")).toEqual({});
  });
});
