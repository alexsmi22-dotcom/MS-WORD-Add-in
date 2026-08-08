// Symbolic ODEs, Release 1: the four families, verified by substitution;
// everything else refused by name.

import { solveOdeSymbolic } from "../odeSymbolic";
import { parseExpr, evalAst } from "../solve";

function joined(r: NonNullable<ReturnType<typeof solveOdeSymbolic>>): string {
  return r.steps.map((s) => s.text ?? s.math).join("\n");
}

describe("direct integration", () => {
  test("y' = 2x → y = x² + C", () => {
    const r = solveOdeSymbolic("y' = 2x")!;
    expect(r.classification).toBe("direct integration");
    expect(r.verified).toBe("verified");
    expect(r.solution.replace(/\s+/g, "")).toMatch(/y=x\^2\+C/);
    expect(r.family).toHaveLength(3);
  });

  test("dy/dx notation folds", () => {
    const r = solveOdeSymbolic("dy/dx = cos(x)")!;
    expect(r.classification).toBe("direct integration");
    expect(r.solution).toContain("sin(x)");
  });
});

describe("separable", () => {
  test("y' = k-less exponential growth: y' = 2y → y = C e^{2x}", () => {
    const r = solveOdeSymbolic("y' = 2y")!;
    expect(r.classification).toBe("separable");
    expect(r.explicit).toBe(true);
    expect(r.verified).toBe("verified");
    expect(r.solution.replace(/\s+/g, "")).toContain("C*exp(");
    // The lost constant solution is named.
    expect(r.caveats.some((c) => c.includes("y = 0"))).toBe(true);
  });

  test("y' = x/y stays implicit, honestly", () => {
    const r = solveOdeSymbolic("y' = x/y")!;
    expect(r.classification).toBe("separable");
    expect(r.explicit).toBe(false);
    expect(r.verified).toBe("implicit-form");
    expect(r.caveats.some((c) => c.includes("implicit"))).toBe(true);
  });

  test("y' = x*y separates with the x factor intact", () => {
    const r = solveOdeSymbolic("y' = x*y")!;
    expect(r.explicit).toBe(true);
    // y = C·e^{x²/2}: verify the family member at C=2 numerically.
    const member = r.family[2].expr;
    const y = evalAst(parseExpr(member), { x: 1 });
    expect(y).toBeCloseTo(2 * Math.exp(0.5), 6);
  });
});

describe("linear first order", () => {
  test("y' = x - y solves via the integrating factor", () => {
    const r = solveOdeSymbolic("y' = x - y")!;
    expect(r.classification).toBe("linear first order");
    expect(r.verified).toBe("verified");
    expect(joined(r)).toContain("integrating factor");
    // y = x − 1 + C e^{−x}: check a family member's value.
    const member = r.family[1].expr; // C = 0.5
    const y = evalAst(parseExpr(member), { x: 0 });
    expect(y).toBeCloseTo(-1 + 0.5, 6);
  });
});

describe("second order, constant coefficients", () => {
  test("y'' + 3y' + 2y = 0 → two real exponentials", () => {
    const r = solveOdeSymbolic("y'' + 3y' + 2y = 0")!;
    expect(r.classification).toContain("second order");
    expect(r.verified).toBe("verified");
    const s = r.solution.replace(/\s+/g, "");
    expect(s).toContain("exp(-1x)");
    expect(s).toContain("exp(-2x)");
  });

  test("y'' + 4y = 0 → pure oscillation", () => {
    const r = solveOdeSymbolic("y'' + 4y = 0")!;
    expect(r.solution).toContain("cos(2 x)");
    expect(r.solution).toContain("sin(2 x)");
    expect(r.verified).toBe("verified");
  });

  test("y'' - 2y' + y = 0 → repeated root picks up the x factor", () => {
    const r = solveOdeSymbolic("y'' - 2y' + y = 0")!;
    expect(r.solution.replace(/\s+/g, "")).toContain("(C1+C2x)");
    expect(r.verified).toBe("verified");
  });

  test("damped oscillation keeps its envelope", () => {
    const r = solveOdeSymbolic("y'' + 2y' + 5y = 0")!;
    expect(r.solution).toContain("exp(-1 x)");
    expect(r.solution).toContain("cos(2 x)");
    expect(r.verified).toBe("verified");
  });
});

describe("honest refusals", () => {
  test("not an ODE at all → null (other kinds own it)", () => {
    expect(solveOdeSymbolic("x^2 - 5x + 6 = 0")).toBeNull();
    expect(solveOdeSymbolic("")).toBeNull();
  });

  test("nonlinear y' (Riccati-ish) refused by name with the supported list", () => {
    const r = solveOdeSymbolic("y' = x + y^2")!;
    expect(r.solution).toBe("");
    expect(joined(r)).toContain("does not fit a family this release solves");
    expect(joined(r)).toContain("This release solves");
  });

  test("variable-coefficient second order refused", () => {
    const r = solveOdeSymbolic("y'' + x*y = 0")!;
    expect(r.solution).toBe("");
    expect(joined(r)).toContain("constant-coefficient");
  });

  test("(y')^2 refused (nonlinear in y')", () => {
    const r = solveOdeSymbolic("y' * y' = x")!;
    expect(r.solution).toBe("");
  });

  test("other function names refused with the found symbols listed", () => {
    const r = solveOdeSymbolic("y' = t*y + z")!;
    expect(r.solution).toBe("");
    expect(joined(r)).toContain("t");
  });
});

describe("adversarial regressions", () => {
  test("a forcing term vanishing at the classifier's sample points cannot slip through", () => {
    // (x−0.4)(x−1.3) is zero exactly where the remainder was sampled; the old
    // verifier then re-derived truth from the extracted coefficients and
    // certified a WRONG solution as verified. Verification now runs against
    // the original equation.
    const r = solveOdeSymbolic("y'' + y + (x-0.4)*(x-1.3) = 0")!;
    expect(r.verified).not.toBe("verified");
    expect(r.solution).toBe("");
  });

  test("third order refused BY NAME, not blamed on parentheses", () => {
    const r = solveOdeSymbolic("y''' + y = 0")!;
    expect(r.solution).toBe("");
    expect(joined(r)).toContain("Third- and higher-order");
    expect(joined(r)).not.toContain("parenthes");
  });

  test("no exp(0 x) in displayed solutions", () => {
    expect(solveOdeSymbolic("y'' = 0")!.solution.includes("exp(0")).toBe(false);
    const r = solveOdeSymbolic("y'' + y' = 0")!;
    expect(r.solution).not.toContain("exp(0");
    expect(r.verified).toBe("verified");
  });
});

describe("every explicit solution genuinely solves its ODE", () => {
  test("residual spot-checks across the battery", () => {
    const battery: Array<[string, (x: number, y: number) => number]> = [
      ["y' = 2x", (x) => 2 * x],
      ["y' = 2y", (_x, y) => 2 * y],
      ["y' = x - y", (x, y) => x - y],
      ["y' = x*y", (x, y) => x * y],
    ];
    for (const [ode, rhs] of battery) {
      const r = solveOdeSymbolic(ode)!;
      expect(r.explicit).toBe(true);
      for (const member of r.family) {
        const sol = parseExpr(member.expr);
        for (const x of [0.2, 1.1]) {
          const h = 1e-6;
          const y = evalAst(sol, { x });
          const dy = (evalAst(sol, { x: x + h }) - evalAst(sol, { x: x - h })) / (2 * h);
          expect(dy).toBeCloseTo(rhs(x, y), 3);
        }
      }
    }
  });
});
