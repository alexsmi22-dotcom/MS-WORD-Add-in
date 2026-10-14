/**
 * The simplify verb on the v2.136.0 CAS (SCOPE-SYMBOLIC-BATCH §B2, §D "GCD"):
 * casSimplifyReport with exactRadicals — the multivariate common factor is
 * cancelled AND NAMED, the "cancelling can remove points" caveat appears only
 * when something was cancelled, a GCD cap is refused by name, and exact
 * radicals simplify to exact 0 instead of float residue. Expected results are
 * SymPy 1.14.0 `cancel` (term order is the CAS's canonical order).
 *
 * (algebraTools.test.ts belongs to the root-engine builder this release; the
 * simplify pins live here so the two never meet.)
 */
import { tryAlgebraVerb } from "../algebraTools";
import { parseExpr, evalAst } from "../solve";

const POINT_CAVEAT = "Cancelling a factor can remove points where the ORIGINAL was undefined (0/0) — the equality is algebraic, not pointwise everywhere.";
const run = (body: string) => tryAlgebraVerb(`simplify ${body}`)!;

describe("multivariate common factors are cancelled and named", () => {
  const cases: [string, string, string][] = [
    ["(x^2 - y^2)/(x - y)", "x + y", "x - y"],
    ["(x^2 + 2*x*y + y^2)/(x + y)", "x + y", "x + y"],
    ["(x^2 - y^2)/(x^2 - 2*x*y + y^2)", "(x + y)/(x - y)", "x - y"],
    ["(a^3 - b^3)/(a - b)", "a*b + a^2 + b^2", "a - b"],
    ["(x*y + x)/(y + 1)", "x", "y + 1"],
    ["(x^4 - y^4)/(x^2 + y^2)", "x^2 - y^2", "x^2 + y^2"],
    ["(x^2 - y^2)/(x + y) + y", "x", "x + y"],
    ["(x^2 - 4*y^2)/(x + 2*y)", "x - 2*y", "x + 2*y"],
    ["(x^3 + y^3)/(x^2 - x*y + y^2)", "x + y", "x^2 - x*y + y^2"],
    ["(x^2*y + x*y^2)/(x^2 - y^2)", "x*y/(x - y)", "x + y"],
    ["(x^2 + x*y - 2*y^2)/(x^2 - y^2)", "(x + 2*y)/(x + y)", "x - y"],
    ["(x^3*y - x*y^3)/(x^2*y + x*y^2)", "x - y", "x + y"],
    ["(sin(x)^2 - cos(x)^2)/(sin(x) - cos(x))", "cos(x) + sin(x)", "cos(x) - sin(x)"],
  ];
  it.each(cases)("simplify %s → %s, cancelling %s", (body, result, g) => {
    const v = run(body);
    expect(v.lines[0]).toEqual({ text: result, math: true });
    expect(v.lines[1].text).toBe(`Cancelled the common factor ${g}; equal to the original except where ${g} = 0 (there the original is 0/0).`);
    // The named factor replaces the generic caveat — not both.
    expect(v.caveats).not.toContain(POINT_CAVEAT);
    // Equal where both are defined (a fixed generic point, every symbol distinct).
    const env: Record<string, number> = { x: 0.73, y: 1.91, a: 0.73, b: 1.91 };
    expect(evalAst(parseExpr(result), env)).toBeCloseTo(evalAst(parseExpr(body), env), 10);
  });
});

describe("the point-removal caveat only when something was cancelled", () => {
  it("single-atom cancellation (no boundary factor) keeps the caveat", () => {
    expect(run("(x^2 - 1)/(x - 1)").lines.map((l) => l.text)).toEqual(["x + 1"]);
    expect(run("(x^2 - 1)/(x - 1)").caveats).toContain(POINT_CAVEAT);
    expect(run("(x^2*y - y)/(x*y + y)").lines[0].text).toBe("x - 1");
    expect(run("(x^2*y - y)/(x*y + y)").caveats).toContain(POINT_CAVEAT);
  });
  it("nothing cancelled → no caveat, even with a '/' in the input", () => {
    expect(run("x/y").caveats).not.toContain(POINT_CAVEAT);
    expect(run("x/y").lines).toEqual([{ text: "x/y", math: true }]);
    expect(run("1/(x + 1) + 1/(x - 1)").caveats).not.toContain(POINT_CAVEAT);
  });
});

describe("a GCD cap is refused BY NAME, never silently", () => {
  it("degree 13 in one symbol stays unreduced and says why", () => {
    const v = run("(x^13 - y^13)/(x - y)");
    expect(v.lines[0].text).toBe("(x^13 - y^13)/(x - y)");
    expect(v.caveats.join("\n")).toContain("The multivariate common-factor search did not run, so a common factor may remain: degree cap (above 12 in one symbol)");
  });
  it("degree 12 is inside the cap and cancels", () => {
    const v = run("(x^12 - y^12)/(x - y)");
    expect(v.lines[1].text).toContain("Cancelled the common factor x - y");
  });
});

describe("exact radicals: an exact zero is 0, not float residue (WRONG #2)", () => {
  it.each([
    ["cbrt(2)^3 - 2", "0"],
    ["(sqrt(2)+sqrt(3))^4 - 10*(sqrt(2)+sqrt(3))^2 + 1", "0"],
    ["sqrt(8)", "2*sqrt(2)"],
    ["sin(pi/6)", "1/2"],
  ])("simplify %s → %s", (body, out) => {
    expect(run(body).lines[0].text).toBe(out);
  });
  it("ordinary simplification is unchanged", () => {
    expect(run("x + x").lines[0].text).toBe("2*x");
    expect(run("0.5*x + 0.25").lines[0].text).toBe("x/2 + 1/4");
  });
});
