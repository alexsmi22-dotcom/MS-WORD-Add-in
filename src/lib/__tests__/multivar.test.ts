/** Multivariable calculus — the acceptance audit from docs/SCOPE-LAPLACE-MULTIVAR.md §D. */
import { parseExpr, evalAst } from "../solve";
import { tryMultivar } from "../multivar";

const run = (q: string) => {
  const v = tryMultivar(q);
  if (!v) throw new Error("not a verb: " + q);
  if (!v.lines.length) throw new Error("refused: " + v.caveats.join(" | "));
  return v;
};
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const mathLine = (q: string, prefix: RegExp) => {
  const l = run(q).lines.find((x) => prefix.test(x.text));
  if (!l) throw new Error("no line " + prefix + " in\n" + text(q));
  return l.text.replace(prefix, "");
};
const same = (a: string, b: string, vars: Record<string, number>[]) => {
  const ea = parseExpr(a);
  const eb = parseExpr(b);
  for (const env of vars) expect(Math.abs(evalAst(ea, env) - evalAst(eb, env))).toBeLessThan(1e-9 * Math.max(1, Math.abs(evalAst(eb, env))));
};
const pts = [{ x: 0.3, y: 0.7, z: 1.1, r: 1.4, theta: 0.6 }, { x: -1.2, y: 2.1, z: -0.4, r: 0.5, theta: 2.2 }];

describe("gradient", () => {
  it("gradient x^2 y + y^3 = (2xy, x² + 3y²)", () => {
    same(mathLine("gradient x^2 y + y^3", /^f_x = /), "2*x*y", pts);
    same(mathLine("gradient x^2 y + y^3", /^f_y = /), "x^2 + 3*y^2", pts);
    expect(text("gradient x^2 y + y^3")).toMatch(/order x, y/);
  });
  it("gradient x^2+y^2+z^2 at (1,2,3) = (2, 4, 6), |∇f| = sqrt(56) = 2 sqrt(14)", () => {
    const t = text("gradient x^2+y^2+z^2 at (1,2,3)");
    expect(t).toMatch(/∇f\(1,2,3\) = \(2, 4, 6\)/);
    expect(t).toMatch(/\|∇f\| = 2\*sqrt\(14\)/);
  });
  it("an explicit variable order is honoured", () => {
    expect(text("gradient a*b^2 in b, a")).toMatch(/order b, a/);
  });
});

describe("hessian and jacobian", () => {
  it("hessian x^3 + x y^2 = [[6x, 2y], [2y, 2x]], det = 12x² − 4y²", () => {
    same(mathLine("hessian x^3 + x y^2", /^f_xx = /), "6*x", pts);
    same(mathLine("hessian x^3 + x y^2", /^f_xy = /), "2*y", pts);
    same(mathLine("hessian x^3 + x y^2", /^f_yy = /), "2*x", pts);
    same(mathLine("hessian x^3 + x y^2", /^det H = /), "12*x^2 - 4*y^2", pts);
  });
  it("jacobian (r cos(theta), r sin(theta)) has det r", () => {
    same(mathLine("jacobian (r cos(theta), r sin(theta))", /^det J = /), "r", pts);
  });
  it("a non-square jacobian says so", () => {
    expect(text("jacobian (x + y, x - y, x*y)")).toMatch(/not square/);
  });
});

describe("directional derivative", () => {
  it("x^2 y at (1,2) in direction (3,4) = 16/5", () => {
    expect(mathLine("directional derivative x^2 y at (1,2) in direction (3,4)", /^D_u f\(1,2\) = /)).toBe("16/5");
  });
  it("a zero direction is refused", () => {
    expect(tryMultivar("directional derivative x*y at (1,1) in direction (0,0)")!.caveats[0]).toMatch(/zero/);
  });
});

describe("critical points", () => {
  it("x^2+y^2-2x-4y: (1, 2) minimum", () => {
    const t = text("critical points x^2+y^2-2x-4y");
    expect(t).toMatch(/\(1, 2\): local minimum/);
  });
  it("x^3-3x+y^2: (1,0) minimum, (−1,0) saddle", () => {
    const t = text("critical points x^3-3x+y^2");
    expect(t).toMatch(/\(1, 0\): local minimum/);
    expect(t).toMatch(/\(-1, 0\): saddle/);
  });
  it("x^3+y^3-3xy: (0,0) saddle, (1,1) minimum", () => {
    expect(tryMultivar("critical points x^3+y^3-3xy")!.caveats[0]).toMatch(/xy was read as ONE variable named xy/);
    const t = text("critical points x^3+y^3-3*x*y");
    expect(t).not.toMatch(/numeric/);
    expect(t).toMatch(/\(1, 1\): local minimum/);
    expect(t).toMatch(/\(0, 0\): saddle/);
  });
  it("x^4+y^4: (0,0) inconclusive by the test", () => {
    const t = text("critical points x^4+y^4");
    expect(t).toMatch(/\(0, 0\): INCONCLUSIVE/);
    expect(t).not.toMatch(/numeric/);
  });
  it("one variable is sent to the equation kind", () => {
    expect(tryMultivar("critical points x^3 - 3x")!.caveats[0]).toMatch(/ONE variable/);
  });
});

describe("lagrange multipliers", () => {
  it("x y subject to x^2+y^2=1: ±1/2, bounded so max and min are declared", () => {
    const t = text("lagrange x y subject to x^2+y^2=1");
    expect(t).toMatch(/Maximum f = 1\/2 at \(sqrt\(2\)\/2, sqrt\(2\)\/2\)/);
    expect(t).toMatch(/minimum f = -1\/2/);
  });
  it("x+y subject to x^2+y^2=2: max 2 at (1,1), min −2 at (−1,−1)", () => {
    const t = text("lagrange x+y subject to x^2+y^2=2");
    expect(t).toMatch(/Maximum f = 2 at \(1, 1\)/);
    expect(t).toMatch(/minimum f = -2 at \(-1, -1\)/);
  });
  it("x^2+y^2 subject to x+y=1: min 1/2 at (1/2,1/2), unbounded so no maximum is declared", () => {
    const v = run("lagrange x^2+y^2 subject to x+y=1");
    const t = v.lines.map((l) => l.text).join("\n");
    expect(t).toMatch(/\(1\/2, 1\/2\): f = 1\/2/);
    expect(t).not.toMatch(/Maximum f/);
    expect(v.caveats.join(" ")).toMatch(/boundedness was not established/);
  });
  it("maximise/minimise are spellings", () => {
    expect(tryMultivar("maximize x*y subject to x + y = 10")).not.toBeNull();
  });
});

describe("iterated integrals", () => {
  it("double integral x y over x from 0 to 1, y from 0 to 2 = 1", () => {
    expect(mathLine("double integral x y over x from 0 to 1, y from 0 to 2", /^= /)).toBe("1");
  });
  it("double integral x^2+y^2 over y from 0 to x, x from 0 to 1 = 1/3", () => {
    expect(mathLine("double integral x^2+y^2 over y from 0 to x, x from 0 to 1", /^= /)).toBe("1/3");
  });
  it("triple integral x y z over x from 0 to 1, y from 0 to 1, z from 0 to 1 = 1/8", () => {
    expect(mathLine("triple integral x y z over x from 0 to 1, y from 0 to 1, z from 0 to 1", /^= /)).toBe("1/8");
  });
  it("a non-elementary inner integral is given numerically and says so", () => {
    const v = run("double integral exp(-x^2) over x from 0 to 1, y from 0 to 1");
    expect(v.lines[0].text).toMatch(/≈ 0\.7468/);
    expect(v.caveats[0]).toMatch(/numerical/);
  });
  it("bounds depending on an INNER variable are refused with the order rule", () => {
    expect(tryMultivar("double integral x y over x from 0 to y, y from 0 to x")!.caveats[0]).toMatch(/outer variables/);
  });
  it("the wrong number of bounds is refused", () => {
    expect(tryMultivar("double integral x y over x from 0 to 1")!.caveats[0]).toMatch(/needs 2 bound/);
  });
});

describe("vector fields", () => {
  it("divergence (x^2, y^2, z^2) = 2x + 2y + 2z", () => {
    same(mathLine("divergence (x^2, y^2, z^2)", /^div F = /), "2*x + 2*y + 2*z", pts);
  });
  it("curl (y, -x, 0) = (0, 0, −2)", () => {
    expect(text("curl (y, -x, 0)")).toMatch(/curl F = \(0, 0, -2\)/);
  });
  it("curl (yz, xz, xy) = 0 and the potential is xyz", () => {
    expect(text("curl (y z, x z, x y)")).toMatch(/curl F = \(0, 0, 0\)/);
    same(mathLine("potential (y z, x z, x y)", /^φ = /).replace(/ \+ C$/, ""), "x*y*z", pts);
  });
  it("curl of a gradient is zero", () => {
    expect(text("curl (2 x y z, x^2 z, x^2 y)")).toMatch(/curl F = \(0, 0, 0\)/);
  });
  it("line integral (2xy, x^2) from (0,0) to (1,2) = 2", () => {
    expect(mathLine("line integral (2 x y, x^2) from (0,0) to (1,2)", /^= /)).toBe("2");
  });
  it("line integral (y, -x) is refused as path-dependent", () => {
    expect(tryMultivar("line integral (y, -x) from (0,0) to (1,1)")!.caveats[0]).toMatch(/PATH/);
  });
  it("potential (2x+y, x+2y) = x² + xy + y²", () => {
    same(mathLine("potential (2 x + y, x + 2 y)", /^φ = /).replace(/ \+ C$/, ""), "x^2 + x*y + y^2", pts);
  });
  it("2D curl is the scalar ∂Q/∂x − ∂P/∂y", () => {
    expect(text("curl (-y, x)")).toMatch(/= 2/);
  });
});

describe("routing", () => {
  it("is not a verb for ordinary input", () => {
    expect(tryMultivar("x^2 - 5x + 6 = 0")).toBeNull();
    expect(tryMultivar("laplace t^2")).toBeNull();
    expect(tryMultivar("gradient descent")).toBeNull();
  });
  it("every math line re-parses (display contract)", () => {
    for (const q of ["gradient x^2 y + y^3", "hessian x^3 + x y^2", "jacobian (r cos(theta), r sin(theta))", "double integral x^2+y^2 over y from 0 to x, x from 0 to 1", "potential (2 x + y, x + 2 y)"]) {
      for (const l of run(q).lines.filter((x) => x.math)) {
        expect(() => parseExpr(l.text.replace(/^[^=]*= /, ""))).not.toThrow();
      }
    }
  });
});
