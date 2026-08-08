// The two long-standing integration gaps, closed: trig power reduction and
// the cyclic-by-parts exp×trig family. Every result still rides the engine's
// differentiate-back gate; these tests additionally pin VALUES via the
// fundamental theorem so a plausible-but-wrong closed form cannot pass.

import { antiderivative, integrate, parseExpr, evalAst } from "../solve";
import { solveOdeSymbolic } from "../odeSymbolic";

/** F(b) − F(a) computed from the returned antiderivative string. */
function ftc(F: string, a: number, b: number): number {
  const ast = parseExpr(F);
  return evalAst(ast, { x: b }) - evalAst(ast, { x: a });
}

describe("trig power reduction", () => {
  test("∫sin²x over [0, π] = π/2, exactly the classic", () => {
    const r = antiderivative("sin(x)^2", "x");
    expect(r).not.toBeNull();
    expect(ftc(r!.antiderivative, 0, Math.PI)).toBeCloseTo(Math.PI / 2, 9);
  });

  test("∫cos²x over [0, 2π] = π", () => {
    const r = antiderivative("cos(x)^2", "x")!;
    expect(ftc(r.antiderivative, 0, 2 * Math.PI)).toBeCloseTo(Math.PI, 9);
  });

  test("linear inner functions ride along: ∫sin²(3x)", () => {
    const r = antiderivative("sin(3x)^2", "x")!;
    // d/dx F = sin²(3x) at a few points.
    const F = parseExpr(r.antiderivative);
    for (const x of [0.3, 1.1, 2.2]) {
      const h = 1e-6;
      const dF = (evalAst(F, { x: x + h }) - evalAst(F, { x: x - h })) / (2 * h);
      expect(dF).toBeCloseTo(Math.sin(3 * x) ** 2, 4);
    }
  });

  test("sin²+cos² integrands still work term by term (the identity is never needed)", () => {
    const r = antiderivative("sin(x)^2 + cos(x)^2", "x")!;
    expect(ftc(r.antiderivative, 0, 5)).toBeCloseTo(5, 6);
  });

  test("the definite-integral kind gets the exact path now", () => {
    const r = integrate("sin(x)^2", 0, Math.PI)!;
    expect(r.value).toBeCloseTo(Math.PI / 2, 9);
    expect(r.antiderivative).toBeTruthy(); // symbolic, not Simpson
  });
});

describe("cyclic by parts: exp × trig", () => {
  test("∫eˣ sin x = eˣ(sin x − cos x)/2 (checked by value)", () => {
    const r = antiderivative("exp(x)*sin(x)", "x");
    expect(r).not.toBeNull();
    const want = (b: number, a: number): number =>
      (Math.exp(b) * (Math.sin(b) - Math.cos(b))) / 2 - (Math.exp(a) * (Math.sin(a) - Math.cos(a))) / 2;
    expect(ftc(r!.antiderivative, 0, 2)).toBeCloseTo(want(2, 0), 9);
  });

  test("∫eˣ cos x matches its closed form", () => {
    const r = antiderivative("exp(x)*cos(x)", "x")!;
    const want = (Math.exp(2) * (Math.cos(2) + Math.sin(2))) / 2 - (Math.exp(0) * (Math.cos(0) + Math.sin(0))) / 2;
    expect(ftc(r.antiderivative, 0, 2)).toBeCloseTo(want, 9);
  });

  test("general coefficients: ∫e^(2x) cos(3x)", () => {
    const r = antiderivative("exp(2x)*cos(3x)", "x")!;
    const F = parseExpr(r.antiderivative);
    for (const x of [0.4, 1.3]) {
      const h = 1e-6;
      const dF = (evalAst(F, { x: x + h }) - evalAst(F, { x: x - h })) / (2 * h);
      expect(dF).toBeCloseTo(Math.exp(2 * x) * Math.cos(3 * x), 3);
    }
  });

  test("constant factors and order don't matter: ∫5 sin(x) eˣ", () => {
    const r = antiderivative("5*sin(x)*exp(x)", "x")!;
    expect(ftc(r.antiderivative, 0, 1)).toBeCloseTo(
      5 * ((Math.exp(1) * (Math.sin(1) - Math.cos(1))) / 2 - (1 * (0 - 1)) / 2),
      9,
    );
  });

  test("phase shifts ride along: ∫e^(x+1) sin(2x+3)", () => {
    const r = antiderivative("exp(x+1)*sin(2x+3)", "x")!;
    const F = parseExpr(r.antiderivative);
    for (const x of [0.2, 1.5]) {
      const h = 1e-6;
      const dF = (evalAst(F, { x: x + h }) - evalAst(F, { x: x - h })) / (2 * h);
      expect(dF).toBeCloseTo(Math.exp(x + 1) * Math.sin(2 * x + 3), 3);
    }
  });
});

describe("the cross-engine win: the ODE y' = sin(x) − y now solves", () => {
  test("linear first order with the once-refused ∫eˣ sin x integral", () => {
    const r = solveOdeSymbolic("y' = sin(x) - y")!;
    expect(r.classification).toBe("linear first order");
    expect(r.solution).not.toBe("");
    expect(r.verified).toBe("verified");
  });
});

describe("what stays refused, honestly", () => {
  test("higher trig powers are still refused (no fake closed form)", () => {
    expect(antiderivative("sin(x)^4", "x")).toBeNull();
  });

  test("exp of a NONLINEAR argument times trig is still refused", () => {
    expect(antiderivative("exp(x^2)*sin(x)", "x")).toBeNull();
  });

  test("x·eˣ·sin x (three x-factors) is still refused rather than misread", () => {
    expect(antiderivative("x*exp(x)*sin(x)", "x")).toBeNull();
  });
});
