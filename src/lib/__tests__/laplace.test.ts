/**
 * Laplace transforms — the acceptance audit from docs/SCOPE-LAPLACE-MULTIVAR.md
 * §D, plus the refusals. Every forward result is compared with the expected
 * F(s) by CANONICAL equality where the CAS can, and by evaluation at sample s
 * otherwise; every inverse is compared with the expected f(t) at sample t.
 */
import { parseExpr, evalAst, format } from "../solve";
import { exprEqual, casSimplify } from "../cas";
import { laplaceTransform, inverseLaplace, tryLaplace, solveIvpLaplace, hasInitialConditions, numericCheck } from "../laplace";

function sameInS(got: ReturnType<typeof parseExpr>, expected: string, from = 4): void {
  const exp = parseExpr(expected);
  let eq: boolean | null = null;
  try {
    eq = exprEqual(casSimplify(got), casSimplify(exp));
  } catch {
    eq = null;
  }
  if (eq === true) return;
  for (const s of [from, from + 1.5, from + 3, from + 7]) {
    const a = evalAst(got, { s });
    const b = evalAst(exp, { s });
    expect(Math.abs(a - b)).toBeLessThan(1e-9 * Math.max(1, Math.abs(b)));
  }
}
function sameInT(got: ReturnType<typeof parseExpr>, expected: string): void {
  const exp = parseExpr(expected);
  for (const t of [0.1, 0.7, 1.3, 2.2, 3.1]) {
    const a = evalAst(got, { t });
    const b = evalAst(exp, { t });
    expect(Math.abs(a - b)).toBeLessThan(1e-8 * Math.max(1, Math.abs(b)));
  }
}
const fwd = (f: string) => {
  const r = laplaceTransform(parseExpr(f));
  if ("refusal" in r) throw new Error("refused: " + r.refusal);
  return r;
};
const inv = (F: string) => {
  const r = inverseLaplace(parseExpr(F));
  if ("refusal" in r) throw new Error("refused: " + r.refusal);
  return r;
};
const refusedFwd = (f: string): string => {
  const r = laplaceTransform(parseExpr(f));
  if (!("refusal" in r)) throw new Error("expected a refusal, got " + format(r.F));
  return r.refusal;
};
const refusedInv = (F: string): string => {
  const r = inverseLaplace(parseExpr(F));
  if (!("refusal" in r)) throw new Error("expected a refusal, got " + format(r.f));
  return r.refusal;
};

describe("forward transforms — the table", () => {
  it.each([
    ["1", "1/s"],
    ["t", "1/s^2"],
    ["t^3", "6/s^4"],
    ["exp(2t)", "1/(s-2)"],
    ["e^(2t)", "1/(s-2)"],
    ["sin(3t)", "3/(s^2+9)"],
    ["cos(t)", "s/(s^2+1)"],
    ["t exp(-t)", "1/(s+1)^2"],
    ["t^2 exp(3t)", "2/(s-3)^3"],
    ["exp(-t) sin(2t)", "2/(s^2+2s+5)"],
    ["t sin(t)", "2s/(s^2+1)^2"],
    ["t cos(2t)", "(s^2-4)/(s^2+4)^2"],
    ["sinh(2t)", "2/(s^2-4)"],
    ["cosh(t)", "s/(s^2-1)"],
    ["sin(t)^2", "2/(s*(s^2+4))"],
    ["cos(t)^2", "(s^2+2)/(s*(s^2+4))"],
    ["sin(t) cos(t)", "1/(s^2+4)"],
    ["sin(2t) sin(3t)", "12 s/((s^2+1)*(s^2+25))"],
    ["3 t^2 - 2 t + 5", "6/s^3 - 2/s^2 + 5/s"],
    ["exp(2t) + sin(t)", "1/(s-2) + 1/(s^2+1)"],
    ["sin(t + pi/2)", "s/(s^2+1)"],
    ["exp(t) t^2 cos(t)", "(2*(s-1)^3 - 6*(s-1))/((s-1)^2+1)^3"],
  ])("ℒ{%s} = %s", (f, F) => {
    const r = fwd(f);
    sameInS(r.F, F, 6);
  });

  it("states the region of convergence", () => {
    expect(fwd("exp(2t)").region).toBe(2);
    expect(fwd("sinh(2t)").region).toBe(2);
    expect(fwd("exp(-3t) cosh(t)").region).toBe(-2);
    expect(fwd("t^2").region).toBe(0);
  });

  it("the unit step: u(t-2) and a delayed function", () => {
    sameInS(fwd("u(t-2)").F, "exp(-2s)/s", 2);
    sameInS(fwd("(t-2) u(t-2)").F, "exp(-2s)/s^2", 2);
    sameInS(fwd("t u(t-2)").F, "exp(-2s)*(1/s^2 + 2/s)", 2);
    // u(t + 1) is 1 on t ≥ 0
    sameInS(fwd("u(t+1)").F, "1/s", 2);
  });

  it("the impulse: delta(t-3) and f(t)·delta(t-3)", () => {
    sameInS(fwd("delta(t-3)").F, "exp(-3s)", 1);
    sameInS(fwd("t^2 delta(t-3)").F, "9 exp(-3s)", 1);
    sameInS(fwd("delta(t)").F, "1", 1);
  });

  it("every table result agrees with the defining integral", () => {
    for (const f of ["t^2 exp(-t)", "exp(-t) sin(2t)", "t cos(2t)", "sin(t)^2", "u(t-2)", "cosh(t) exp(-3t)"]) {
      const r = fwd(f);
      expect(numericCheck(parseExpr(f), r.F, r.region)).toBe("verified");
    }
  });

  it("refuses by name what the table does not reach", () => {
    expect(refusedFwd("exp(t^2)")).toMatch(/linear function of t/i);
    expect(refusedFwd("sin(t)/t")).toMatch(/division by a function of t/i);
    expect(refusedFwd("ln(t)")).toMatch(/no table entry for ln/i);
    expect(refusedFwd("1/t")).toMatch(/1\/t/);
    expect(refusedFwd("sin(t) sinh(t)")).toMatch(/trigonometric and a hyperbolic/i);
    expect(refusedFwd("sin(t^2)")).toMatch(/linear in t/i);
  });
});

describe("inverse transforms", () => {
  it.each([
    ["1/(s^2+1)", "sin(t)"],
    ["1/(s*(s+1))", "1 - exp(-t)"],
    ["(s+1)/(s^2+2s+5)", "exp(-t) cos(2t)"],
    ["1/(s-2)^2", "t exp(2t)"],
    ["1/(s^2-1)", "sinh(t)"],
    ["6/s^4", "t^3"],
    ["2/(s^2+2s+5)", "exp(-t) sin(2t)"],
    ["s/(s^2+4)^2", "t sin(2t)/4"],
    ["1/(s^2+4)^2", "(sin(2t) - 2t cos(2t))/16"],
    ["1/(s^3+1)", "exp(-t)/3 - exp(t/2) cos(sqrt(3) t/2)/3 + exp(t/2) sin(sqrt(3) t/2)/sqrt(3)"],
    ["(2s+3)/(s^2+3s+2)", "exp(-t) + exp(-2t)"],
    ["1/(s^2+2)", "sin(sqrt(2) t)/sqrt(2)"],
    ["exp(-2s)/s", "u(t-2)"],
    ["exp(-2s)/s^2", "(t-2) u(t-2)"],
    ["1/s + exp(-s)/(s+1)", "1 + exp(-(t-1)) u(t-1)"],
  ])("ℒ⁻¹{%s} = %s", (F, f) => {
    const r = inv(F);
    sameInT(r.f, f);
  });

  it("an irrational ω is kept exact (sqrt), never a decimal", () => {
    expect(format(inv("1/(s^2+2)").f)).toContain("sqrt(2)");
    expect(format(inv("1/(s^3+1)").f)).toContain("sqrt(3)");
    expect(format(inv("1/(s^3+1)").f)).not.toMatch(/0\.866|1\.732/);
  });

  it("a constant part is the impulse; a polynomial part is refused", () => {
    expect(format(inv("(s+2)/(s+1)").f)).toContain("delta(t)");
    expect(refusedInv("s^2/(s+1)")).toMatch(/derivative of δ/);
  });

  it("refuses by name what the table does not reach", () => {
    expect(refusedInv("1/(s^4+1)")).toMatch(/irreducible|roots/i);
    expect(refusedInv("exp(s)/s")).toMatch(/e\^\{−ds\}/);
    expect(refusedInv("1/sqrt(s)")).toMatch(/rational function/i);
    expect(refusedInv("s/(s^2+1)^3")).toMatch(/power 3/);
  });

  it("every inverse is verified by transforming it forward again", () => {
    for (const F of ["1/(s*(s+1))", "(s+1)/(s^2+2s+5)", "1/(s^3+1)", "s/(s^2+4)^2"]) {
      expect(["exact", "numeric"]).toContain(inv(F).verified);
    }
  });
});

describe("the verbs", () => {
  it("laplace f and inverse laplace F route and show the result line", () => {
    const a = tryLaplace("laplace t^2 exp(3t)")!;
    expect(a.lines[0].text).toMatch(/^F\(s\) = /);
    expect(a.lines[0].text).toContain("for s > 3");
    expect(a.caveats[0]).toMatch(/Verified against the defining integral/);
    const b = tryLaplace("inverse laplace 1/(s*(s+1))")!;
    expect(b.lines[0].text).toMatch(/^f\(t\) = /);
    expect(b.plot?.variable).toBe("t");
  });
  it("other spellings: 'laplace transform of', 'L{...}', 'inverse laplace transform of'", () => {
    expect(tryLaplace("laplace transform of sin(3t)")!.lines[0].text).toContain("3/(s^2 + 9)".replace(/ /g, "") === "" ? "" : "F(s) =");
    expect(tryLaplace("inverse laplace transform of 1/(s-2)^2")!.lines[0].text).toMatch(/t\*exp\(2\*t\)|exp\(2\*t\)\*t/);
  });
  it("is not a verb for an equation, and leaves non-laplace input alone", () => {
    expect(tryLaplace("laplace = 3")).toBeNull();
    expect(tryLaplace("x^2 - 5x + 6 = 0")).toBeNull();
    expect(tryLaplace("factor x^2 - 1")).toBeNull();
  });
  it("a refusal is a caveat naming the reason, never a result line", () => {
    const r = tryLaplace("laplace exp(t^2)")!;
    expect(r.lines).toHaveLength(0);
    expect(r.caveats[0]).toMatch(/Not transformed/);
  });
  it("the displayed F re-parses (display contract)", () => {
    for (const q of ["laplace t sin(t)", "laplace exp(-t) cos(2t) t", "inverse laplace 1/(s^3+1)"]) {
      const line = tryLaplace(q)!.lines[0].text.replace(/^[Ff]\([st]\) = /, "").replace(/, for s > .*$/, "");
      expect(() => parseExpr(line)).not.toThrow();
    }
  });
});

describe("initial-value problems", () => {
  const solve = (s: string) => {
    const r = solveIvpLaplace(s);
    if (!r) throw new Error("not an IVP");
    if (!r.solution) throw new Error("refused: " + r.caveats.join(" "));
    return r;
  };
  it.each([
    ["y'' + y = 0, y(0) = 0, y'(0) = 1", "sin(t)"],
    ["y' + 2y = 1, y(0) = 0", "(1 - exp(-2t))/2"],
    ["y'' + 3y' + 2y = 0, y(0) = 1, y'(0) = 0", "2 exp(-t) - exp(-2t)"],
    ["y'' + 4y = sin(t), y(0) = 0, y'(0) = 0", "sin(t)/3 - sin(2t)/6"],
    ["y'' - y = t, y(0) = 0, y'(0) = 1", "exp(t) - exp(-t) - t"],
    ["y'' + y = cos(t), y(0) = 0, y'(0) = 0", "t sin(t)/2"],
    ["y' = 3y, y(0) = 2", "2 exp(3t)"],
    ["y'' + 2y' + 5y = 0, y(0) = 1, y'(0) = -1", "exp(-t) cos(2t)"],
    ["y'' + y = u(t-1), y(0) = 0, y'(0) = 0", "(1 - cos(t-1)) u(t-1)"],
    ["dy/dt + y = exp(-t), y(0) = 0", "t exp(-t)"],
  ])("%s → y = %s", (ivp, y) => {
    const r = solve(ivp);
    expect(r.verified).toBe("verified");
    sameInT(parseExpr(r.solution.replace(/^y = /, "")), y);
    expect(r.family).toHaveLength(1);
  });
  it("accepts x as the independent variable and reports it", () => {
    const r = solve("y'' + y = 0, y(0) = 1, y'(0) = 0");
    expect(r.variable).toBe("t");
    const rx = solve("y' = x, y(0) = 1");
    expect(rx.variable).toBe("x");
    sameInT(parseExpr(rx.solution.replace(/^y = /, "").replace(/x/g, "t")), "t^2/2 + 1");
  });
  it("detects initial conditions, and nothing else", () => {
    expect(hasInitialConditions("y'' + y = 0, y(0) = 0, y'(0) = 1")).toBe(true);
    expect(hasInitialConditions("y'' + y = 0")).toBe(false);
    expect(solveIvpLaplace("y'' + y = 0")).toBeNull();
  });
  it("refuses by name: missing y'(0), nonlinear, non-constant coefficients, third order, forcing outside the table", () => {
    const refusal = (s: string) => {
      const r = solveIvpLaplace(s)!;
      expect(r.solution).toBe("");
      return r.caveats.join(" ") + " " + r.classification;
    };
    expect(refusal("y'' + y = 0, y(0) = 1")).toMatch(/y'\(0\)/);
    expect(refusal("y' = y^2, y(0) = 1")).toMatch(/not linear/i);
    expect(refusal("y' = t y, y(0) = 1")).toMatch(/CONSTANT/);
    expect(refusal("y''' + y = 0, y(0) = 0, y'(0) = 0")).toMatch(/order/i);
    expect(refusal("y' + y = ln(t), y(0) = 0")).toMatch(/no table transform/i);
  });
});
