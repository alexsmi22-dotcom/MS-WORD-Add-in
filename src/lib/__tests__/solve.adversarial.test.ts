// Adversarial bug test — the offline math solver (solve.ts).
//
// Correctness is the whole point of this module, so the tests are built to
// FALSIFY it, not confirm it:
//   * every symbolic DERIVATIVE is checked against a central finite difference
//     at random points — if the rule is wrong, the numbers diverge;
//   * every equation ROOT is back-substituted — f(root) must be ~0;
//   * numeric INTEGRALS are checked against known closed-form antiderivatives;
//   * honesty: multi-unknown equations are refused, no-solution and identity are
//     reported as such, and complex roots are never dropped or faked as real.

import {
  solveEquation, differentiate, integrate, parseExpr, evalAst, derivative, simplify,
} from "../solve";

// ---------------------------------------------------------------------------
// Derivatives vs finite differences — the strong test.
// ---------------------------------------------------------------------------
describe("symbolic derivative matches a central finite difference", () => {
  const EXPRS = [
    "x^2", "x^3 - 5*x + 2", "1/x", "sqrt(x)", "sin(x)", "cos(x)", "tan(x)",
    "exp(x)", "ln(x)", "sin(x)*cos(x)", "x*exp(x)", "sin(x^2)", "exp(sin(x))",
    "x/(x^2+1)", "ln(x^2+1)", "atan(x)", "cos(3*x)", "sqrt(x^2+1)", "x^4 - 3*x^2",
    "1/(x+2)", "(x^2+1)/(x-3)", "tanh(x)", "asin(x)", "2^x", "x^x",
  ];
  // Points chosen to stay inside every domain above (positive, |x|<1 for asin).
  const POINTS = [0.3, 0.5, 0.7, 0.85];

  for (const src of EXPRS) {
    it(`d/dx ${src}`, () => {
      const e = parseExpr(src);
      const d = simplify(derivative(e, "x"));
      for (const x of POINTS) {
        const h = 1e-6;
        const numeric = (evalAst(e, { x: x + h }) - evalAst(e, { x: x - h })) / (2 * h);
        const symbolic = evalAst(d, { x });
        if (!Number.isFinite(numeric)) continue;
        expect(Math.abs(symbolic - numeric)).toBeLessThan(1e-3);
      }
    });
  }
});

describe("differentiate() returns readable, correct expressions", () => {
  it("power rule", () => {
    expect(differentiate("x^2")!.derivative).toBe("2*x");
  });
  it("basic trig", () => {
    expect(differentiate("sin(x)")!.derivative).toBe("cos(x)");
  });
  it("chain rule prints in conventional order (coefficient first, function last)", () => {
    // Guards the fix that turned cos(x^2)*2*x into 2*x*cos(x^2) — matching the
    // in-app help text. The value is verified separately by the finite-difference
    // sweep; this pins the readable factor order.
    expect(differentiate("sin(x^2)")!.derivative).toBe("2*x*cos(x^2)");
  });
  it("constant", () => {
    expect(differentiate("5")!.derivative).toBe("0");
  });
  it("sum rule", () => {
    // 3x^2 + 2 in some spelling
    const d = differentiate("x^3 + 2*x")!.derivative;
    const e = parseExpr(d);
    for (const x of [0.4, 1.1, 2.3]) {
      expect(Math.abs(evalAst(e, { x }) - (3 * x * x + 2))).toBeLessThan(1e-9);
    }
  });
  it("flags abs() non-differentiability and multi-variable", () => {
    expect(differentiate("abs(x)")!.caveats.some((c) => /abs/.test(c))).toBe(true);
    expect(differentiate("a*x^2")!.caveats.some((c) => /constant/.test(c))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Equation solving — exact and numeric, always back-substituted.
// ---------------------------------------------------------------------------
const backSubOk = (input: string, variable = "x") => {
  const r = solveEquation(input, variable);
  expect(r).not.toBeNull();
  if (!r) return;
  const parts = input.split("=");
  const lhs = parseExpr(parts[0]);
  const rhs = parts.length === 2 ? parseExpr(parts[1]) : parseExpr("0");
  for (const root of r.roots) {
    if (root.im !== 0) continue; // only real roots can be back-substituted here
    const resid = evalAst(lhs, { [variable]: root.re }) - evalAst(rhs, { [variable]: root.re });
    expect(Math.abs(resid)).toBeLessThan(1e-5);
  }
};

describe("linear and quadratic are solved exactly", () => {
  it("linear", () => {
    const r = solveEquation("2*x + 4 = 0")!;
    expect(r.method).toContain("linear");
    expect(r.roots.map((x) => x.re)).toEqual([-2]);
    expect(r.roots[0].exact).toBe(true);
  });
  it("linear with implicit multiplication", () => {
    const r = solveEquation("3x - 9 = 0")!;
    expect(r.roots[0].re).toBeCloseTo(3, 10);
  });
  it("quadratic, two real roots", () => {
    const r = solveEquation("x^2 - 5*x + 6 = 0")!;
    expect(r.method).toContain("quadratic");
    expect(r.roots.map((x) => x.re).sort((a, b) => a - b)).toEqual([2, 3]);
    r.roots.forEach((x) => expect(x.exact).toBe(true));
  });
  it("quadratic, double root", () => {
    const r = solveEquation("x^2 - 2*x + 1 = 0")!;
    expect(r.roots.length).toBe(1);
    expect(r.roots[0].re).toBeCloseTo(1, 10);
  });
  it("quadratic with complex roots — reported, never dropped or faked real", () => {
    const r = solveEquation("x^2 + 1 = 0")!;
    expect(r.roots.length).toBe(2);
    expect(r.roots.every((x) => x.im !== 0)).toBe(true);
    expect(r.caveats.some((c) => /complex/i.test(c))).toBe(true);
    expect(r.roots.map((x) => x.display).join(",")).toMatch(/i/);
  });
  for (const eq of ["x^2 - 5*x + 6 = 0", "2*x + 4 = 0", "x^2 = 9", "3*x - 1 = x + 5", "x^2 + x - 12 = 0"]) {
    it(`back-substitutes: ${eq}`, () => backSubOk(eq));
  }
});

// A complex polynomial evaluation, to back-substitute EVERY root (incl. complex).
const polyAtComplex = (coeffs: number[], re: number, im: number) => {
  let ar = 0, ai = 0;
  for (let k = coeffs.length - 1; k >= 0; k--) {
    const nr = ar * re - ai * im + coeffs[k];
    const ni = ar * im + ai * re;
    ar = nr; ai = ni;
  }
  return Math.hypot(ar, ai);
};
// Extract ascending coeffs of a monovariate polynomial via finite differences on a grid.
// (Simpler: parse known polynomials directly in the tests below.)

describe("polynomial equations return ALL roots (real and complex)", () => {
  it("cubic with three real roots", () => {
    const r = solveEquation("x^3 - 6*x^2 + 11*x - 6 = 0")!;
    const found = r.roots.map((x) => x.re).sort((a, b) => a - b);
    expect(found.length).toBe(3);
    [1, 2, 3].forEach((want, k) => expect(found[k]).toBeCloseTo(want, 4));
    expect(r.method).toContain("complete");
  });
  it("x^3 - 1 = 0 gives all three roots, not just the real one", () => {
    const r = solveEquation("x^3 - 1 = 0")!;
    expect(r.roots.length).toBe(3);
    // one real root 1, two complex -1/2 ± (√3/2)i
    expect(r.roots.some((x) => Math.abs(x.re - 1) < 1e-6 && x.im === 0)).toBe(true);
    expect(r.roots.filter((x) => x.im !== 0).length).toBe(2);
    for (const root of r.roots) expect(polyAtComplex([-1, 0, 0, 1], root.re, root.im)).toBeLessThan(1e-6);
  });
  it("x^4 - 1 = 0 gives 1, -1, i, -i", () => {
    const r = solveEquation("x^4 - 1 = 0")!;
    expect(r.roots.length).toBe(4);
    for (const root of r.roots) expect(polyAtComplex([-1, 0, 0, 0, 1], root.re, root.im)).toBeLessThan(1e-6);
    expect(r.roots.filter((x) => x.im !== 0).length).toBe(2); // ±i
    expect(r.roots.filter((x) => x.im === 0).length).toBe(2); // ±1
  });
  it("Vieta: for a monic cubic, the roots sum to −(coeff of x²)", () => {
    const r = solveEquation("x^3 - 2*x^2 - 5*x + 6 = 0")!;
    const sum = r.roots.reduce((s, x) => s + x.re * (x.display.includes("×") ? 2 : 1), 0);
    // roots are 1, 3, -2 → sum 2 = −(−2)
    expect(sum).toBeCloseTo(2, 4);
    for (const root of r.roots) expect(polyAtComplex([6, -5, -2, 1], root.re, root.im)).toBeLessThan(1e-6);
  });
  it("repeated roots collapse with a multiplicity marker", () => {
    // (x-1)^3 = x^3 - 3x^2 + 3x - 1
    const r = solveEquation("x^3 - 3*x^2 + 3*x - 1 = 0")!;
    const one = r.roots.find((x) => Math.abs(x.re - 1) < 1e-5);
    expect(one).toBeTruthy();
    expect(one!.display).toMatch(/×3/);
  });
  it("exp equation", () => {
    const r = solveEquation("exp(x) - 2 = 0", "x", 50)!;
    expect(r.roots.some((x) => Math.abs(x.re - Math.log(2)) < 1e-4)).toBe(true);
  });
  it("trig equation over a bounded range", () => {
    const r = solveEquation("cos(x)", "x", 5)!;
    expect(r.roots.some((x) => Math.abs(Math.abs(x.re) - Math.PI / 2) < 1e-4)).toBe(true);
    r.roots.forEach((root) => expect(Math.abs(Math.cos(root.re))).toBeLessThan(1e-4));
  });
});

describe("honesty on degenerate equations", () => {
  it("no solution", () => {
    const r = solveEquation("x + 1 = x + 2")!;
    expect(r.method).toBe("no-solution");
    expect(r.roots.length).toBe(0);
  });
  it("identity", () => {
    const r = solveEquation("2*(x + 1) = 2*x + 2")!;
    expect(r.method).toBe("identity");
  });
  it("refuses a multi-unknown equation instead of guessing", () => {
    const r = solveEquation("x + y = 3")!;
    expect(r.method).toBe("unsolved");
    expect(r.caveats.some((c) => /more than one unknown/.test(c))).toBe(true);
  });
  it("returns null on unparseable input", () => {
    expect(solveEquation("2 +* 3 =")).toBeNull();
    expect(solveEquation("((x+1)")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unicode super/subscripts are accepted like their ASCII forms.
// ---------------------------------------------------------------------------
describe("typed/pasted Unicode super- and subscripts parse like ^ and _", () => {
  it("x² solves the same as x^2", () => {
    const r = solveEquation("x² - 5x + 6 = 0")!;
    expect(r).not.toBeNull();
    expect(r.roots.map((x) => x.re).sort((a, b) => a - b)).toEqual([2, 3]);
  });
  it("x² + 1 = 0 still gives the complex pair", () => {
    const r = solveEquation("x² + 1 = 0")!;
    expect(r.roots.every((x) => x.im !== 0)).toBe(true);
  });
  it("multi-digit superscript x¹⁰", () => {
    // d/dx x^10 = 10 x^9; check the value at a point.
    const d = parseExpr(differentiate("x¹⁰")!.derivative);
    expect(Math.abs(evalAst(d, { x: 1.5 }) - 10 * Math.pow(1.5, 9))).toBeLessThan(1e-6);
  });
  it("negative superscript exponent 2⁻³", () => {
    expect(evalAst(parseExpr("2⁻³"), {})).toBeCloseTo(0.125, 10);
  });
  it("subscript folds into a variable name (x₁ → x_1)", () => {
    const r = solveEquation("x₁ + 2 = 5")!;
    expect(r.roots[0].re).toBeCloseTo(3, 10);
  });
  it("derivative of x² prints 2*x", () => {
    expect(differentiate("x²")!.derivative).toBe("2*x");
  });
});

// ---------------------------------------------------------------------------
// Numeric integration vs known closed forms.
// ---------------------------------------------------------------------------
describe("definite integrals match known values", () => {
  const cases: [string, number, number, number][] = [
    ["x^2", 0, 3, 9],
    ["sin(x)", 0, Math.PI, 2],
    ["cos(x)", 0, Math.PI / 2, 1],
    ["exp(x)", 0, 1, Math.E - 1],
    ["1/x", 1, Math.E, 1],
    ["x^3", -2, 2, 0],
    ["2*x + 1", 0, 4, 20],
  ];
  for (const [src, a, b, want] of cases) {
    it(`∫ ${src} dx from ${a} to ${b} = ${want.toFixed(3)}`, () => {
      const r = integrate(src, a, b)!;
      expect(r).not.toBeNull();
      expect(Math.abs(r.value - want)).toBeLessThan(1e-6);
    });
  }
  it("refuses to integrate with an unresolved parameter", () => {
    expect(integrate("a*x", 0, 1)).toBeNull();
  });
});

describe("integration is EXACT (symbolic) where a rule applies, numeric otherwise", () => {
  const exactCases: [string, number, number, number][] = [
    ["x^2", 0, 3, 9],
    ["x^3", -2, 2, 0],
    ["sin(x)", 0, Math.PI, 2],
    ["1/x", 1, Math.E, 1],
    ["exp(2*x)", 0, 1, (Math.E * Math.E - 1) / 2],
    ["sin(2*x)", 0, Math.PI / 2, 1],
    ["1/(x^2+1)", 0, 1, Math.PI / 4],
    ["3*x^2 + 2*x + 1", 0, 2, 14],
  ];
  for (const [src, a, b, want] of exactCases) {
    it(`∫ ${src} is exact = ${want.toFixed(4)}`, () => {
      const r = integrate(src, a, b)!;
      expect(r.method).toBe("exact (symbolic)");
      expect(r.antiderivative).toBeTruthy();
      expect(Math.abs(r.value - want)).toBeLessThan(1e-9);
    });
  }

  it("the reported antiderivative F actually satisfies F' = integrand", () => {
    const r = integrate("x^3 + sin(x)", 0, 1)!;
    const dF = parseExpr(differentiate(r.antiderivative!)!.derivative);
    for (const x of [0.3, 0.9, 1.7]) {
      const integrand = Math.pow(x, 3) + Math.sin(x);
      expect(Math.abs(evalAst(dF, { x }) - integrand)).toBeLessThan(1e-6);
    }
  });

  it("falls back to numeric when no rule applies (exp(x^2))", () => {
    const r = integrate("exp(x^2)", 0, 1)!;
    expect(r.method).toBe("adaptive Simpson");
    expect(Math.abs(r.value - 1.4626517459)).toBeLessThan(1e-6); // known ∫₀¹ e^{x²}
  });

  it("falls back to numeric for a product it can't integrate (x*exp(x))", () => {
    const r = integrate("x*exp(x)", 0, 1)!;
    // ∫₀¹ x e^x dx = 1 (exactly), Simpson gets it numerically
    expect(Math.abs(r.value - 1)).toBeLessThan(1e-6);
  });
});
