// The v2.110.0 equation-engine upgrade — oracle tests.
//
// Four wrong answers fixed (cancelled-pole holes, decimals labelled [exact],
// odd rational roots, "range searched" excuses for impossible equations), and
// the comprehensive layer: exact answer forms, trig general solutions, exp/log
// closed forms, chained and absolute-value inequalities, reciprocal trig,
// vulgar-fraction glyphs.

import { solveEquation, parseExpr, evalAst } from "../solve";
import { solveInequality } from "../inequalities";

const displays = (eq: string): string[] => solveEquation(eq)!.roots.map((r) => r.display);
const flags = (eq: string): boolean[] => solveEquation(eq)!.roots.map((r) => !!r.exact);

describe("exact answer forms — the display earns its [exact] tag", () => {
  test("rationals stay rational: 3x = 1 answers 1/3, not 0.333… [exact]", () => {
    expect(displays("3*x = 1")).toEqual(["1/3"]);
    expect(flags("3*x = 1")).toEqual([true]);
    expect(displays("x/3 + 1/4 = 2")).toEqual(["21/4"]);
  });

  test("surds appear as surds: x² = 2 answers ±sqrt(2)", () => {
    expect(displays("x^2 = 2")).toEqual(["sqrt(2)", "-sqrt(2)"]);
    expect(displays("x^2 - 8 = 0")).toEqual(["2*sqrt(2)", "-2*sqrt(2)"]);
    expect(displays("x^2 - x - 1 = 0")).toEqual(["1/2 + sqrt(5)/2", "1/2 - sqrt(5)/2"]);
  });

  test("complex exact pairs keep the product's conventions", () => {
    expect(displays("x^2 + x + 1 = 0")).toEqual(["-1/2 + sqrt(3)/2*i", "-1/2 - sqrt(3)/2*i"]);
    expect(displays("9*x^2 + 4 = 0")).toEqual(["2/3*i", "-2/3*i"]);
    expect(displays("x^2 - 2*x + 2 = 0")).toEqual(["1 + i", "1 - i"]);
  });

  test("a perfect-square discriminant folds to plain rationals", () => {
    expect(displays("x^2 + x - 6 = 0")).toEqual(["2", "-3"]);
  });

  test("irrational coefficients drop the exact flag honestly", () => {
    const r = solveEquation("2*pi*r = 10")!;
    expect(r.roots[0].exact).toBe(false);
  });

  test("every exact display re-parses and evaluates to its own value", () => {
    for (const eq of ["x^2 = 2", "x^2 - x - 1 = 0", "3*x = 1", "x^2 + x + 1 = 0", "4*x^2 = 9", "x^2 - 1e-20 = 0"]) {
      for (const root of solveEquation(eq)!.roots) {
        const ast = parseExpr(root.display);
        const re = evalAst(ast, { i: 0 });
        const im = evalAst(ast, { i: 1 }) - re;
        expect(re).toBeCloseTo(root.re, 9);
        expect(im).toBeCloseTo(root.im, 9);
      }
    }
  });
});

describe("trig equations answer with GENERAL solutions", () => {
  test("sin(x) = 1/2: the two families, exact", () => {
    const r = solveEquation("sin(x) = 1/2")!;
    expect(r.method).toBe("trig (general solution)");
    expect(r.roots.map((k) => k.display)).toEqual(["pi/6", "5*pi/6"]);
    expect(r.steps.join(" ")).toContain("pi/6 + 2*pi*n");
    expect(r.steps.join(" ")).toContain("5*pi/6 + 2*pi*n");
  });

  test("cos(x) = 1/2 gives ±pi/3; cos(x) = −1 gives the single family at pi", () => {
    expect(displays("cos(x) = 1/2")).toEqual(["-pi/3", "pi/3"]);
    expect(displays("cos(x) = -1")).toEqual(["pi"]);
  });

  test("tan keeps its own period π and its non-special values numeric", () => {
    const r = solveEquation("tan(x) = 2")!;
    expect(r.roots).toHaveLength(1);
    expect(r.roots[0].re).toBeCloseTo(Math.atan(2), 12);
    expect(r.steps.join(" ")).toContain("pi*n");
    expect(displays("tan(x) = 1")).toEqual(["pi/4"]);
  });

  test("a linear argument folds through: sin(2x) = 1 answers pi/4", () => {
    expect(displays("sin(2*x) = 1")).toEqual(["pi/4"]);
    expect(displays("tan(2*x) = 1")).toEqual(["pi/8"]);
    const shifted = solveEquation("sin(3*x + 1) = 1/2")!;
    expect(shifted.roots.map((k) => k.display)).toEqual(["(pi/6 - 1)/3", "(5*pi/6 - 1)/3"]);
    for (const k of shifted.roots) {
      expect(Math.sin(3 * k.re + 1)).toBeCloseTo(0.5, 10);
    }
  });

  test("a quadratic in the trig atom solves both branches", () => {
    // 2sin²x + sinx − 1 = 0 → sinx = 1/2 or −1 → π/6, 5π/6, −π/2.
    const shown = displays("2*sin(x)^2 + sin(x) - 1 = 0");
    expect(shown).toContain("pi/6");
    expect(shown).toContain("5*pi/6");
    expect(shown).toContain("-pi/2");
  });

  test("sin(x) = 2 refuses by RANGE, not by search", () => {
    const r = solveEquation("sin(x) = 2")!;
    expect(r.method).toBe("no-solution");
    expect(r.caveats.join(" ")).toMatch(/never leaves/);
  });

  test("reciprocal trig folds to the primary function", () => {
    expect(displays("sec(x) = 2")).toEqual(["-pi/3", "pi/3"]);
    expect(displays("csc(x) = 2")).toEqual(["pi/6", "5*pi/6"]);
    expect(displays("cot(x) = 1")).toEqual(["pi/4"]);
    expect(solveEquation("sec(x) = 0.5")!.method).toBe("no-solution");
    expect(solveEquation("csc(x) = 0")!.method).toBe("no-solution");
  });
});

describe("exponential and logarithmic closed forms", () => {
  test("clean integer powers are exact integers: 2^x = 8 answers 3", () => {
    expect(displays("2^x = 8")).toEqual(["3"]);
    expect(displays("3^(x+1) = 81")).toEqual(["3"]);
    expect(flags("2^x = 8")).toEqual([true]);
  });

  test("the general case answers in logarithms: 5^x = 3 is ln(3)/ln(5)", () => {
    const r = solveEquation("5^x = 3")!;
    expect(r.roots[0].display).toBe("ln(3)/ln(5)");
    expect(r.roots[0].re).toBeCloseTo(Math.log(3) / Math.log(5), 12);
  });

  test("exp and ln round-trip exactly", () => {
    expect(displays("exp(x) = 2")).toEqual(["ln(2)"]);
    expect(displays("exp(2*x) = 5")).toEqual(["ln(5)/2"]);
    expect(displays("ln(x) = 1")).toEqual(["exp(1)"]);
    expect(displays("ln(x - 1) = 0")).toEqual(["2"]);
    expect(displays("log10(x) = 2")).toEqual(["100"]);
    // The old numeric scan MISSED ln(x) = −1 entirely (root ≈ 0.368).
    expect(displays("ln(x) = -1")).toEqual(["exp(-1)"]);
  });
});

describe("the four wrong answers, pinned fixed", () => {
  test("odd rational roots: x^(1/3) = −2 answers −8", () => {
    const r = solveEquation("x^(1/3) = -2")!;
    expect(r.roots.some((k) => Math.abs(k.re + 8) < 1e-6)).toBe(true);
  });

  test("impossible equations name the RANGE argument, not the search range", () => {
    for (const [eq, why] of [
      ["abs(x) = -1", /never negative/],
      ["sqrt(x) = -2", /never returns a negative/],
      ["exp(x) = -1", /strictly positive/],
      ["cos(x) = 1.5", /never leaves/],
    ] as [string, RegExp][]) {
      const r = solveEquation(eq)!;
      expect(r.method).toBe("no-solution");
      expect(r.caveats.join(" ")).toMatch(why);
    }
  });

  test("the identity with a hole names the hole", () => {
    const r = solveEquation("(x-1)/(x-1) = 1")!;
    expect(r.method).toBe("identity");
    expect(r.caveats.join(" ")).toMatch(/EXCEPT x = 1/);
  });

  test("the cancelled pole is excluded from the inequality's answer", () => {
    const r = solveInequality("(x^2-1)/(x-1) >= 0")!;
    expect(r.display).toBe("[-1, 1) ∪ (1, ∞)");
  });
});

describe("chained and absolute-value inequalities", () => {
  test("-3 < 2x+1 <= 7 intersects to (-2, 3]", () => {
    expect(solveInequality("-3 < 2*x+1 <= 7")!.display).toBe("(-2, 3]");
  });

  test("the reversed chain reads the same region", () => {
    expect(solveInequality("7 >= 2*x+1 > -3")!.display).toBe("(-2, 3]");
  });

  test("mixed directions are refused by name", () => {
    const r = solveInequality("1 < x > 2")!;
    expect(r.intervals).toEqual([]);
    expect(r.caveats.join(" ")).toMatch(/mixes directions/);
  });

  test("|x−1| < 3 is (−2, 4); |x| ≥ 2 is the two-ray union", () => {
    expect(solveInequality("abs(x-1) < 3")!.display).toBe("(-2, 4)");
    expect(solveInequality("abs(x) >= 2")!.display).toBe("(−∞, -2] ∪ [2, ∞)");
    expect(solveInequality("abs(2*x+1) <= 5")!.display).toBe("[-3, 2]");
  });

  test("|·| against a negative constant answers immediately, both directions", () => {
    expect(solveInequality("abs(x) < -1")!.display).toBe("∅ (no solution)");
    expect(solveInequality("abs(x) > -1")!.display).toBe("(−∞, ∞)");
  });

  test("chained with three comparators is not misread", () => {
    expect(solveInequality("1 < x < 2 < 3")).toBeNull();
  });
});

describe("defects found by the independent adversarial pass (v2.110.0), pinned", () => {
  test("1: exp/log exact displays honour the same length cap as quadratics", () => {
    const r = solveEquation("2^x = 1e300")!;
    expect(r.roots[0].display.length).toBeLessThanOrEqual(48);
    expect(r.roots[0].exact).toBe(false); // a decimal display earns no tag
    expect(r.roots[0].re).toBeCloseTo(300 * Math.log(10) / Math.log(2), 6);
  });

  test("2: an EXACT t barely above 1 refuses — no π/2 for an unsolvable equation", () => {
    const r = solveEquation("sin(x)^2 = 1 + 1e-13")!;
    expect(r.roots).toHaveLength(0);
    expect(r.steps.join(" ")).toMatch(/outside \[−1, 1\]/);
    // The boundary itself still answers.
    expect(solveEquation("sin(x)^2 = 1")!.roots.length).toBeGreaterThan(0);
  });

  test("2b: sin(x) = 1 + 1e-13 stays refused directly too", () => {
    // impossibleByRange carries no epsilon — this must never clamp.
    const r = solveEquation("sin(x) = 1 + 1e-13")!;
    expect(r.roots).toHaveLength(0);
  });

  test("the integer-power fold reaches 2^x = 2^94", () => {
    expect(displays("2^x = 2^94")).toEqual(["94"]);
  });
});

describe("input forms", () => {
  test("Word's own ½ glyph parses", () => {
    const r = solveEquation("sin(x) = ½")!;
    expect(r.roots.map((k) => k.display)).toEqual(["pi/6", "5*pi/6"]);
  });

  test("sec/csc/cot differentiate too — the fn tables stay in step", () => {
    for (const fn of ["sec(x)", "csc(x)", "cot(x)"]) {
      expect(() => parseExpr(fn)).not.toThrow();
      const v = evalAst(parseExpr(fn), { x: 0.7 });
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
