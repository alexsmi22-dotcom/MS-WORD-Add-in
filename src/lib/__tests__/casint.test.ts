// Symbolic integration (casint.ts) — CAS-DESIGN Release 2.
//
// The design names the correctness net for this module explicitly: "every
// antiderivative must be checked by differentiating it back and comparing
// canonical forms". That check lives inside symbolicIntegrate itself, so these
// tests attack it from the outside instead:
//
//   * INDEPENDENT verification — every F is differentiated back HERE and
//     compared numerically at sample points, so a bug in the module's own
//     verifier cannot hide a wrong answer;
//   * definite integrals are compared against known closed-form values;
//   * the refusals are pinned too: what it cannot do must return null and fall
//     back to quadrature, never a plausible-looking wrong antiderivative.

import { parseExpr, evalAst, format, derivative, integrate, differentiate } from "../solve";
import { symbolicIntegrate } from "../casint";

const antideriv = (src: string): string | null => {
  const r = symbolicIntegrate(parseExpr(src), "x", derivative);
  return r ? format(r.F) : null;
};

/**
 * Differentiates the reported F independently and requires F' == f at sample
 * points inside the domain. This is the real test — it does not trust the
 * module's internal verification at all.
 */
function checkAntiderivative(src: string, points: number[]): void {
  const F = antideriv(src);
  expect(F).not.toBeNull();
  const dF = parseExpr(differentiate(F!)!.derivative);
  const f = parseExpr(src);
  let compared = 0;
  for (const x of points) {
    const want = evalAst(f, { x });
    const got = evalAst(dF, { x });
    if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
    expect(Math.abs(got - want)).toBeLessThan(1e-6 * (1 + Math.abs(want)));
    compared++;
  }
  expect(compared).toBeGreaterThan(0);
}

describe("integration by parts", () => {
  const CASES: [string, number[]][] = [
    ["x*exp(x)", [0.3, 1.1, 2.0]],
    ["x^2*exp(x)", [0.3, 1.1]],
    ["x*sin(x)", [0.4, 1.5, 2.7]],
    ["x*cos(x)", [0.4, 1.5]],
    ["ln(x)", [0.6, 1.4, 3.2]],
    ["x*ln(x)", [0.6, 1.4, 3.2]],
    ["atan(x)", [0.3, 1.2]],
    ["x^2*sin(x)", [0.5, 1.3]],
  ];
  for (const [src, pts] of CASES) {
    it(`∫ ${src} dx`, () => checkAntiderivative(src, pts));
  }

  it("∫ x·eˣ dx = eˣ(x − 1) + C, the CAS-DESIGN §1 example", () => {
    const F = antideriv("x*exp(x)")!;
    // Any spelling is fine as long as it equals eˣ(x−1).
    const got = parseExpr(F);
    for (const x of [0.4, 1.7, -0.8]) {
      expect(evalAst(got, { x })).toBeCloseTo(Math.exp(x) * (x - 1), 9);
    }
  });
});

describe("substitution", () => {
  const CASES: [string, number[]][] = [
    ["2*x*cos(x^2)", [0.4, 1.1]],
    ["x*exp(x^2)", [0.3, 0.9]],
    ["tan(x)", [0.3, 1.1]],
    ["x/(x^2+1)", [0.5, 2.0]],
    ["sin(x)*cos(x)", [0.4, 1.2]],
    ["exp(sin(x))*cos(x)", [0.4, 1.2]],
    ["2*x/(x^2+3)", [0.5, 1.8]],
  ];
  for (const [src, pts] of CASES) {
    it(`∫ ${src} dx`, () => checkAntiderivative(src, pts));
  }
});

describe("partial fractions (exact rational arithmetic)", () => {
  const CASES: [string, number[]][] = [
    ["1/(x*(x+1))", [0.5, 2.0, 3.5]],
    ["1/(x^2-1)", [2.0, 3.5]],
    ["(2*x+3)/(x^2+3*x+2)", [0.5, 2.0]],
    ["1/(x^2+4)", [0.4, 1.6]],
    ["1/(x^2+2*x+5)", [0.4, 1.6]],
    ["x^3/(x^2+1)", [0.4, 1.6]],
    ["1/(x^2*(x+1))", [0.6, 2.2]],
    ["(x+1)/(x^2-4)", [3.0, 5.0]],
  ];
  for (const [src, pts] of CASES) {
    it(`∫ ${src} dx`, () => checkAntiderivative(src, pts));
  }

  it("1/(x²+4) uses atan with the right scale, not a bare atan(x)", () => {
    const F = parseExpr(antideriv("1/(x^2+4)")!);
    // ∫dx/(x²+4) = atan(x/2)/2
    for (const x of [0.7, 2.3]) {
      expect(evalAst(F, { x })).toBeCloseTo(Math.atan(x / 2) / 2, 9);
    }
  });

  it("exact rationals: 1/(x²−1) splits into halves, not 0.4999999", () => {
    const F = antideriv("1/(x^2-1)")!;
    expect(F).toMatch(/\/2/);
    expect(F).not.toMatch(/0\.49999|0\.50000\d/);
  });
});

describe("definite integrals become EXACT where they used to be numeric", () => {
  const CASES: [string, number, number, number][] = [
    ["x*exp(x)", 0, 1, 1],
    ["ln(x)", 1, Math.E, 1],
    ["x*sin(x)", 0, Math.PI, Math.PI],
    ["1/(x*(x+1))", 1, 2, Math.log(4 / 3)],
    ["1/(x^2+4)", 0, 2, Math.PI / 8],
    ["2*x*cos(x^2)", 0, Math.sqrt(Math.PI / 2), 1],
    ["x/(x^2+1)", 0, 1, Math.log(2) / 2],
  ];
  for (const [src, a, b, want] of CASES) {
    it(`∫ ${src} from ${a.toFixed(2)} to ${b.toFixed(2)} = ${want.toFixed(5)} (exact)`, () => {
      const r = integrate(src, a, b)!;
      expect(r).not.toBeNull();
      expect(r.method).toBe("exact (symbolic)");
      expect(r.antiderivative).toBeTruthy();
      expect(Math.abs(r.value - want)).toBeLessThan(1e-9);
    });
  }
});

describe("honest refusal — no plausible-looking wrong answers", () => {
  it("returns null rather than guessing for exp(x²), which has no elementary form", () => {
    expect(antideriv("exp(x^2)")).toBeNull();
  });
  it("exp(x²) still integrates numerically through the public API, and says so", () => {
    const r = integrate("exp(x^2)", 0, 1)!;
    expect(r.method).toBe("adaptive Simpson");
    expect(Math.abs(r.value - 1.4626517459)).toBeLessThan(1e-6);
    expect(r.caveats.some((c) => /approximation/i.test(c))).toBe(true);
  });
  it("sin(x)/x has no elementary antiderivative and is refused", () => {
    expect(antideriv("sin(x)/x")).toBeNull();
  });
  it("a cubic denominator with no rational roots is refused, not approximated", () => {
    // x³ + x + 1 has no rational root; partial fractions cannot split it here.
    const F = antideriv("1/(x^3+x+1)");
    if (F !== null) {
      // If some other rule did find one, it must still be genuinely correct.
      const dF = parseExpr(differentiate(F)!.derivative);
      for (const x of [0.6, 1.7]) {
        expect(evalAst(dF, { x })).toBeCloseTo(1 / (x ** 3 + x + 1), 6);
      }
    }
  });
});

describe("the verification gate actually rejects", () => {
  it("every returned antiderivative differentiates back to the integrand", () => {
    // A broad sweep: whatever the engine claims, it must survive independent
    // differentiation. This is the property that makes the module safe.
    const SWEEP = [
      "x^3", "1/x", "exp(2*x)", "sin(3*x)", "x*exp(x)", "ln(x)", "tan(x)",
      "1/(x^2+1)", "x/(x^2+4)", "1/(x*(x+2))", "x^2*ln(x)", "atan(x)",
      "sqrt(x)", "x*cos(x)", "exp(x)*x^2", "(x+1)/(x^2+2*x+2)",
    ];
    let found = 0;
    for (const src of SWEEP) {
      const F = antideriv(src);
      if (!F) continue;
      found++;
      const dF = parseExpr(differentiate(F)!.derivative);
      const f = parseExpr(src);
      for (const x of [0.43, 1.27, 2.11]) {
        const want = evalAst(f, { x });
        const got = evalAst(dF, { x });
        if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
        expect(Math.abs(got - want)).toBeLessThan(1e-6 * (1 + Math.abs(want)));
      }
    }
    expect(found).toBeGreaterThanOrEqual(14);
  });
});
