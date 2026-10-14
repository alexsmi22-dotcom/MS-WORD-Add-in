// v2.136.0 — the arcsine rule (docs/SCOPE-SYMBOLIC-BATCH.md §B4, §D
// "Integration and multivariable"). ∫ k/√(A·x² + B·x + C) with A < 0 by
// completing the square; every candidate still rides the differentiate-back
// gate, and these tests additionally pin VALUES through the fundamental
// theorem against an independent closed form, so a plausible-but-wrong F
// cannot pass.

import { symbolicIntegrate } from "../casint";
import { casSimplify } from "../cas";
import { antiderivative, integrate, parseExpr, evalAst, derivative, format } from "../solve";

const anti = (f: string) => {
  const r = symbolicIntegrate(casSimplify(parseExpr(f)), "x", derivative);
  if (!r) throw new Error("no antiderivative for " + f);
  return { F: format(r.F), notes: r.notes ?? [], verified: r.verified, ast: r.F };
};
const at = (F: string, x: number, extra: Record<string, number> = {}) => evalAst(parseExpr(F), { x, ...extra });
/** F′ against the integrand at points inside the domain (central differences). */
const derivAgrees = (F: string, f: string, xs: number[], extra: Record<string, number> = {}) => {
  const fe = parseExpr(f);
  for (const x of xs) {
    const h = 1e-6;
    const d = (at(F, x + h, extra) - at(F, x - h, extra)) / (2 * h);
    const want = evalAst(fe, { x, ...extra });
    expect(Math.abs(d - want)).toBeLessThan(1e-5 * Math.max(1, Math.abs(want)));
  }
};

describe("§D antiderivatives, verbatim", () => {
  test("1/sqrt(1-x^2) → asin(x), proved canonically", () => {
    const r = anti("1/sqrt(1-x^2)");
    expect(r.F).toBe("asin(x)");
    expect(r.verified).toBe(true);
    expect(r.notes.join(" ")).toMatch(/\|x\| < 1/);
  });
  test("-1/sqrt(1-x^2) → -asin(x), and the acos equivalence is SAID", () => {
    const r = anti("-1/sqrt(1-x^2)");
    expect(r.F).toBe("-asin(x)");
    expect(r.notes.join(" ")).toMatch(/acos\(x\) is an equally valid antiderivative/);
    expect(r.notes.join(" ")).toMatch(/differ only by a constant/);
  });
  test("1/sqrt(4-x^2) → asin(x/2)", () => {
    expect(anti("1/sqrt(4-x^2)").F).toBe("asin(x/2)");
  });
  test("1/sqrt(9-4x^2) → asin(2*x/3)/2 (same function; printed 1/2*asin(2*x/3))", () => {
    const r = anti("1/sqrt(9-4x^2)");
    for (const x of [-1.2, -0.4, 0.3, 1.1]) expect(at(r.F, x)).toBeCloseTo(Math.asin((2 * x) / 3) / 2, 12);
    expect(r.F).toMatch(/asin\(2\*x\/3\)/);
    expect(r.notes.join(" ")).toMatch(/\|x\| < 3\/2/);
  });
});

describe("scaling and shifts (adversarial)", () => {
  test("1/sqrt(4 - (x-1)^2) → asin((x − 1)/2), domain |x − 1| < 2", () => {
    const r = anti("1/sqrt(4 - (x-1)^2)");
    derivAgrees(r.F, "1/sqrt(4 - (x-1)^2)", [-0.7, 0.2, 1, 2.5]);
    expect(at(r.F, 1)).toBeCloseTo(0, 14);
    expect(r.notes.join(" ")).toMatch(/\|x - 1\| < 2/);
  });
  test("a left shift: 1/sqrt(4 - (x+3)^2), domain |x + 3| < 2", () => {
    const r = anti("1/sqrt(4 - (x+3)^2)");
    derivAgrees(r.F, "1/sqrt(4 - (x+3)^2)", [-4.5, -3, -1.6]);
    expect(r.notes.join(" ")).toMatch(/\|x \+ 3\| < 2/);
  });
  test("an irrational scale stays EXACT in casint (raw sqrt, not a float)", () => {
    const r = anti("1/sqrt(3-2x^2)");
    expect(r.F).toMatch(/sqrt\(2\)/);
    expect(r.F).toMatch(/sqrt\(6\)/);
    derivAgrees(r.F, "1/sqrt(3-2x^2)", [-1.1, 0.2, 1.0]);
  });
  test("a narrow domain (|x| < 1/10) is verified on the narrow samples, not refused", () => {
    const r = anti("1/sqrt(1-100x^2)");
    expect(r.F).toBe("1/10*asin(10*x)");
    derivAgrees(r.F, "1/sqrt(1-100x^2)", [-0.07, 0.01, 0.09]);
  });
  test("the power form (1-x^2)^(-1/2) and a constant numerator", () => {
    expect(anti("(1-x^2)^(-1/2)").F).toBe("asin(x)");
    derivAgrees(anti("3/(2*sqrt(-x^2+2x+3))").F, "3/(2*sqrt(-x^2+2x+3))", [-0.5, 1, 2.5]);
  });
  test("a linear numerator splits: (1 + x)/sqrt(1-x^2) = asin(x) − sqrt(1 − x²)", () => {
    const r = anti("(1 + x)/sqrt(1-x^2)");
    derivAgrees(r.F, "(1 + x)/sqrt(1-x^2)", [-0.8, 0.1, 0.6]);
    expect(r.F).toMatch(/asin\(x\)/);
  });
  test("a sum the simplifier merges into one fraction: x + 1/sqrt(1-x^2)", () => {
    derivAgrees(anti("1/sqrt(1-x^2) + x").F, "1/sqrt(1-x^2) + x", [-0.5, 0.3, 0.9]);
  });
  test("symbolic a: 1/sqrt(a^2 - x^2) = asin(x/a), with a > 0 ASSUMED and said", () => {
    const r = anti("1/sqrt(a^2-x^2)");
    expect(r.F).toBe("asin(x/a)");
    expect(r.notes.join(" ")).toMatch(/Assumes a > 0/);
    derivAgrees(r.F, "1/sqrt(a^2-x^2)", [-1.1, 0.4, 2.0], { a: 2.5 });
  });
  test("no notes leak through a substitution symbol", () => {
    const r = symbolicIntegrate(casSimplify(parseExpr("cos(x)/sqrt(1 - sin(x)^2)")), "x", derivative);
    expect((r?.notes ?? []).join(" ")).not.toMatch(/_u|_r/);
  });
  test("refused, not invented: A > 0 (asinh family), an empty domain, a non-square symbolic constant", () => {
    expect(symbolicIntegrate(casSimplify(parseExpr("1/sqrt(x^2+1)")), "x", derivative)).toBeNull();
    expect(symbolicIntegrate(casSimplify(parseExpr("1/sqrt(-1-x^2)")), "x", derivative)).toBeNull();
    expect(symbolicIntegrate(casSimplify(parseExpr("1/sqrt(a-x^2)")), "x", derivative)).toBeNull();
  });
});

describe("the atan twin, exact (no 0.707106781187)", () => {
  test("1/(x^2+2) → sqrt(2)/2*atan(sqrt(2)/2*x) = atan(x/√2)/√2", () => {
    const r = anti("1/(x^2+2)");
    expect(r.F).toBe("sqrt(2)/2*atan(sqrt(2)/2*x)");
    expect(r.F).not.toMatch(/\d\.\d{6}/);
    for (const x of [-2, 0.5, 3]) expect(at(r.F, x)).toBeCloseTo(Math.atan(x / Math.SQRT2) / Math.SQRT2, 13);
  });
  test("1/(x^2+2x+5) → atan((x + 1)/2)/2", () => {
    const r = anti("1/(x^2+2x+5)");
    for (const x of [-3, 0, 1.7]) expect(at(r.F, x)).toBeCloseTo(Math.atan((x + 1) / 2) / 2, 13);
  });
  test("3/(4x^2+9) → atan(2*x/3)/2", () => {
    expect(anti("3/(4x^2+9)").F).toBe("atan(2*x/3)/2");
  });
  test("one radical in the coefficient: 1/(2x^2+3) → sqrt(6)/6*atan(sqrt(6)/3*x)", () => {
    const r = anti("1/(2x^2+3)");
    expect(r.F).toBe("sqrt(6)/6*atan(sqrt(6)/3*x)");
    derivAgrees(r.F, "1/(2x^2+3)", [-1, 0.3, 2]);
  });
  test("symbolic 1/(x^2+a^2) → 1/a*atan(x/a), a > 0 said (and why a ≠ 0 suffices)", () => {
    const r = anti("1/(x^2+a^2)");
    expect(r.F).toBe("1/a*atan(x/a)");
    expect(r.notes.join(" ")).toMatch(/a > 0/);
    derivAgrees(r.F, "1/(x^2+a^2)", [-1, 0.4, 2], { a: -1.7 });
    derivAgrees(r.F, "1/(x^2+a^2)", [-1, 0.4, 2], { a: 2.3 });
  });
});

describe("definite integrals through the 1-D kind", () => {
  test("∫₀^½ 1/sqrt(1-x^2) = π/6, now exact (symbolic) instead of adaptive Simpson", () => {
    const r = integrate("1/sqrt(1-x^2)", 0, 0.5)!;
    expect(r.method).toMatch(/exact/);
    expect(r.value).toBeCloseTo(Math.PI / 6, 14);
  });
  test("∫₀¹ = π/2 and ∫₋₁¹ = π (improper at the endpoints; asin is continuous there)", () => {
    expect(integrate("1/sqrt(1-x^2)", 0, 1)!.value).toBeCloseTo(Math.PI / 2, 14);
    expect(integrate("1/sqrt(1-x^2)", -1, 1)!.value).toBeCloseTo(Math.PI, 14);
  });
  test("the indefinite kind returns asin(x)", () => {
    expect(antiderivative("1/sqrt(1-x^2)")!.antiderivative).toBe("asin(x)");
  });
  test("4 s bound for the whole family", () => {
    const t = Date.now();
    for (const f of ["1/sqrt(1-x^2)", "1/sqrt(9-4x^2)", "1/sqrt(4-(x-1)^2)", "(1+x)/sqrt(1-x^2)", "1/sqrt(a^2-x^2)"]) symbolicIntegrate(casSimplify(parseExpr(f)), "x", derivative);
    expect(Date.now() - t).toBeLessThan(4000);
  });
});
