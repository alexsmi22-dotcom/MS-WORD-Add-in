// Systems of equations (systems.ts).
//
// The valuable behaviour here is not "it finds x and y" — it is the
// CLASSIFICATION. A linear system has exactly one solution, none, or infinitely
// many, and reporting a single point for a system that actually has a whole line
// of them is a confident wrong answer of exactly the kind this project keeps
// removing. So the three cases are pinned hardest, and the underdetermined case
// must return its GENERAL solution with the free variables named.

import { solveSystem, splitEquations, linearCoeffs, rref } from "../systems";
import { parseExpr } from "../solve";
import { ratInt, ratToNumber, ratMake } from "../cas";
import { fmtRat } from "../geometry";

const S = (...eqs: string[]) => solveSystem(eqs)!;

describe("linear coefficient extraction", () => {
  const lc = (src: string, vars: string[]) => linearCoeffs(parseExpr(src), vars);
  it("reads coefficients and the constant", () => {
    const r = lc("2*x + 3*y - 6", ["x", "y"])!;
    expect(fmtRat(r.coeff.get("x")!)).toBe("2");
    expect(fmtRat(r.coeff.get("y")!)).toBe("3");
    expect(fmtRat(r.constant)).toBe("-6");
  });
  it("keeps fractional coefficients exact", () => {
    const r = lc("x/3 + y/7", ["x", "y"])!;
    expect(fmtRat(r.coeff.get("x")!)).toBe("1/3");
    expect(fmtRat(r.coeff.get("y")!)).toBe("1/7");
  });
  it("refuses anything nonlinear, rather than linearising it", () => {
    expect(lc("x^2", ["x"])).toBeNull();
    expect(lc("x*y", ["x", "y"])).toBeNull();
    expect(lc("sin(x)", ["x"])).toBeNull();
    expect(lc("1/x", ["x"])).toBeNull();
  });
});

describe("exact RREF", () => {
  it("reduces a simple system", () => {
    // x + y = 3 ; x - y = 1  →  x = 2, y = 1
    const m = [
      [ratInt(1), ratInt(1), ratInt(3)],
      [ratInt(1), ratInt(-1), ratInt(1)],
    ];
    const { rows, pivots } = rref(m);
    expect(pivots).toEqual([0, 1]);
    expect(ratToNumber(rows[0][2])).toBeCloseTo(2, 12);
    expect(ratToNumber(rows[1][2])).toBeCloseTo(1, 12);
  });
});

describe("UNIQUE solutions are exact", () => {
  it("2x2, integer", () => {
    const r = S("x + y = 3", "x - y = 1");
    expect(r.kind).toBe("unique");
    expect(r.exact).toEqual({ x: "2", y: "1" });
  });
  it("3x3", () => {
    const r = S("x + y + z = 6", "2*x - y + z = 3", "x + 2*y - z = 2");
    expect(r.kind).toBe("unique");
    expect(r.exact).toEqual({ x: "1", y: "2", z: "3" });
  });
  it("fractional answers stay exact, never decimal", () => {
    // 2x = 1, 3y = 1  →  x = 1/2, y = 1/3
    const r = S("2*x = 1", "3*y = 1");
    expect(r.exact).toEqual({ x: "1/2", y: "1/3" });
  });
  it("fractional COEFFICIENTS are handled exactly", () => {
    // x/3 + y/7 = 1 ; x/3 - y/7 = 0  →  x = 3/2, y = 7/2
    const r = S("x/3 + y/7 = 1", "x/3 - y/7 = 0");
    expect(r.kind).toBe("unique");
    expect(r.exact).toEqual({ x: "3/2", y: "7/2" });
  });
  it("a numeric value accompanies the exact one", () => {
    const r = S("2*x = 1", "y = 5");
    expect(r.numeric![0].x).toBeCloseTo(0.5, 12);
  });
  it("says the solution is unique and why", () => {
    expect(S("x + y = 3", "x - y = 1").steps.join(" ")).toMatch(/UNIQUE/);
  });
});

describe("NO solution is reported as a property of the system", () => {
  it("parallel lines", () => {
    const r = S("x + y = 1", "x + y = 2");
    expect(r.kind).toBe("none");
    expect(r.steps.join(" ")).toMatch(/0 = /);
    expect(r.caveats.join(" ")).toMatch(/CONTRADICT/);
  });
  it("an overdetermined inconsistent system", () => {
    const r = S("x = 1", "y = 2", "x + y = 4");
    expect(r.kind).toBe("none");
  });
  it("does NOT report a fabricated point", () => {
    const r = S("x + y = 1", "x + y = 2");
    expect(r.exact).toBeUndefined();
    expect(r.numeric).toBeUndefined();
  });
});

describe("INFINITELY MANY solutions give the general solution, not one point", () => {
  it("one equation, two unknowns", () => {
    const r = S("x + y = 3");
    expect(r.kind).toBe("infinite");
    expect(r.freeVariables).toEqual(["y"]);
    expect(r.general).toContain("x = 3 - y");
    expect(r.general).toContain("y is free");
  });
  it("a dependent pair", () => {
    // The second equation is twice the first.
    const r = S("x + y = 2", "2*x + 2*y = 4");
    expect(r.kind).toBe("infinite");
    expect(r.freeVariables!.length).toBe(1);
  });
  it("three unknowns, one equation: TWO free variables", () => {
    const r = S("x + y + z = 1");
    expect(r.kind).toBe("infinite");
    expect(r.freeVariables).toEqual(["y", "z"]);
  });
  it("states plainly that a single answer would misrepresent it", () => {
    expect(S("x + y = 3").caveats.join(" ")).toMatch(/does not pin down a single answer/);
  });
  it("the general solution actually satisfies the equation", () => {
    // x = 3 - y: try a few y values.
    const r = S("x + y = 3");
    expect(r.general![0]).toBe("x = 3 - y");
    for (const y of [0, 1, 2.5, -3]) {
      const x = 3 - y;
      expect(x + y).toBeCloseTo(3, 12);
    }
  });
});

describe("NONLINEAR systems go to Newton, and say so", () => {
  it("circle meets line: two intersection points", () => {
    const r = S("x^2 + y^2 = 25", "x + y = 7");
    expect(r.kind).toBe("nonlinear");
    expect(r.numeric!.length).toBe(2);
    // (3,4) and (4,3)
    const pts = r.numeric!.map((p) => [p.x, p.y].map((v) => Math.round(v)).sort().join(","));
    expect(new Set(pts).size).toBe(1); // both are {3,4}
    for (const p of r.numeric!) {
      expect(p.x * p.x + p.y * p.y).toBeCloseTo(25, 6);
      expect(p.x + p.y).toBeCloseTo(7, 6);
    }
  });
  it("every reported root satisfies every equation", () => {
    const r = S("x^2 + y^2 = 4", "y = x^2");
    expect(r.kind).toBe("nonlinear");
    for (const p of r.numeric!) {
      expect(p.x * p.x + p.y * p.y).toBeCloseTo(4, 6);
      expect(p.y).toBeCloseTo(p.x * p.x, 6);
    }
  });
  it("states that Newton may miss solutions", () => {
    const r = S("x^2 + y^2 = 25", "x + y = 7");
    expect(r.caveats.join(" ")).toMatch(/other solutions may exist/i);
    expect(r.caveats.join(" ")).toMatch(/NUMERIC/);
  });
  it("refuses when equations and unknowns do not match", () => {
    const r = S("x^2 + y^2 = 4");
    expect(r.kind).toBe("unsolved");
    expect(r.caveats.join(" ")).toMatch(/as many equations as unknowns/);
  });
});

describe("input handling", () => {
  it("splits multi-line input, ignoring blanks and non-equations", () => {
    expect(splitEquations("x + y = 3\n\nx - y = 1\nnot an equation")).toEqual(["x + y = 3", "x - y = 1"]);
  });
  it("accepts semicolons as separators", () => {
    expect(splitEquations("x = 1; y = 2")).toEqual(["x = 1", " y = 2"].map((s) => s.trim()));
  });
  it("returns null on unparseable or malformed input", () => {
    expect(solveSystem(["x + = 3"])).toBeNull();
    expect(solveSystem(["no equals sign"])).toBeNull();
    expect(solveSystem([])).toBeNull();
  });
  it("variables are discovered and reported in order", () => {
    expect(S("b + a = 3", "a - b = 1").variables).toEqual(["a", "b"]);
  });
});
