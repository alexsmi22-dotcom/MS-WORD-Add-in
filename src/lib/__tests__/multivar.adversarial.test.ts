/**
 * Multivariable calculus — the defects the author's own second probe found
 * behind a green acceptance audit (v2.130.0), pinned so they stay fixed.
 */
import { parseExpr, format } from "../solve";
import { exactSimplify } from "../exact";
import { tryMultivar } from "../multivar";

const run = (q: string) => tryMultivar(q)!;
const text = (q: string) => run(q).lines.map((l) => l.text).join("\n");
const cav = (q: string) => run(q).caveats.join(" | ");

describe("a continuum of critical points is refused, never sampled", () => {
  it("x²y²: ∇f vanishes on the whole line x = 0", () => {
    const v = run("critical points x^2 * y^2");
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/vanishes identically on the whole hyperplane x = 0/);
  });
  it("a dependent LINEAR gradient names the line of critical points", () => {
    const v = run("critical points x^2 + y^2 + z^2 - 2 x y");
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/rank below 3/);
    expect(v.caveats[0]).toMatch(/x = y/);
  });
  it("(x² + y² − 1)²: the circle of minima is NOT forty saddle points — degenerate numerics are dropped and said so", () => {
    const t = text("critical points (x^2 + y^2 - 1)^2");
    expect(t).toMatch(/\(0, 0\): local maximum, f = 1/);
    expect(t).not.toMatch(/saddle/);
    expect(t).not.toMatch(/\(numeric\)/);
    expect(cav("critical points (x^2 + y^2 - 1)^2")).toMatch(/det H = 0 .* dropped/);
  });
});

describe("completeness is claimed only for polynomials", () => {
  it("sin(x) + cos(y) by elimination says the list is NOT complete", () => {
    const v = run("critical points sin(x) + cos(y)");
    expect(v.lines.length).toBeGreaterThan(1);
    expect(v.lines[0].text).toMatch(/search range/);
    expect(v.caveats.join(" ")).toMatch(/NOT a complete list/);
    expect(text("critical points sin(x) + cos(y)")).toMatch(/\(pi\/2, 0\): local maximum, f = 2/);
  });
  it("sin(x) sin(y) numerically: π multiples snapped exactly, nearest the origin first, periodicity said", () => {
    const v = run("critical points sin(x) sin(y)");
    expect(v.lines[1].text).toMatch(/^\(0, 0\): saddle point, f = 0/);
    expect(v.lines[2].text).toMatch(/^\((-?pi\/2), (-?pi\/2)\): local (maximum|minimum), f = -?1/);
    expect(text("critical points sin(x) sin(y)")).not.toMatch(/sin\(\d/);
    expect(cav("critical points sin(x) sin(y)")).toMatch(/repeat with the period/);
  });
  it("a polynomial gradient by elimination carries no incompleteness caveat", () => {
    expect(cav("critical points x^4 - 2 x^2 + y^2")).not.toMatch(/NOT a complete list/);
    const t = text("critical points x^4 - 2 x^2 + y^2");
    expect(t).toMatch(/\(1, 0\): local minimum, f = -1/);
    expect(t).toMatch(/\(-1, 0\): local minimum, f = -1/);
    expect(t).toMatch(/\(0, 0\): saddle point/);
  });
});

describe("numeric points print numbers", () => {
  it("exp(-x²-y²)·x: f and D are evaluated, not left as sin(7.85…)", () => {
    const t = text("critical points exp(-x^2-y^2) * x");
    expect(t).toMatch(/\(sqrt\(2\)\/2, 0\): local maximum/);
    expect(t).toMatch(/\(-sqrt\(2\)\/2, 0\): local minimum/);
  });
});

describe("Lagrange edge cases", () => {
  it("an empty constraint set is named", () => {
    const v = run("lagrange x + y subject to x^2 + y^2 = -1");
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/NO real points/);
  });
  it("an unbounded constraint lists the candidate without declaring a maximum", () => {
    const t = text("lagrange x y subject to x - y = 1");
    expect(t).toMatch(/\(1\/2, -1\/2\): f = -1\/4/);
    expect(t).not.toMatch(/Maximum f/);
  });
});

describe("the fused-name guard", () => {
  it("3xy is refused by name; theta and lam are real names", () => {
    expect(run("critical points x^3+y^3-3xy").caveats[0]).toMatch(/xy was read as ONE variable/);
    expect(run("gradient r cos(theta)").lines.length).toBeGreaterThan(0);
    expect(run("gradient a*b^2 + ab").caveats[0]).toMatch(/ab was read as ONE variable/);
  });
});

describe("exact square roots (exact.ts)", () => {
  const S = (s: string) => format(exactSimplify(parseExpr(s)));
  it.each([
    ["sqrt(0)", "0"],
    ["sqrt(1)", "1"],
    ["sqrt(4)", "2"],
    ["sqrt(56)", "2*sqrt(14)"],
    ["sqrt(4/9)", "2/3"],
    ["sqrt(8/18)", "2/3"],
    ["sqrt(1/2)", "sqrt(2)/2"],
    ["sqrt(3/4)", "sqrt(3)/2"],
    ["sqrt(12)", "2*sqrt(3)"],
    ["sqrt(14)", "sqrt(14)"],
    ["sqrt(2)", "sqrt(2)"],
  ])("%s → %s", (input, expected) => {
    expect(S(input)).toBe(expected);
  });
  it("a non-integer rational and a negative are left alone, and nothing loops", () => {
    expect(() => S("sqrt(2.5)")).not.toThrow();
    expect(() => S("sqrt(-4)")).not.toThrow();
    expect(() => S("sqrt(1e20)")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The independent adversarial pass (~290 probes): 20 items, pinned here.
// ---------------------------------------------------------------------------

describe("iterated integrals cannot hang, crash, or integrate across a pole", () => {
  it("four nested integrals are refused by name in milliseconds (400⁴ midpoint evaluations once froze the pane)", () => {
    const t = Date.now();
    const v = run("iterated integral x y z w over x from 0 to 1, y from 0 to 1, z from 0 to 1, w from 0 to 1");
    expect(Date.now() - t).toBeLessThan(2000);
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/Up to three nested integrals/);
  });
  it("a parameter in the integrand is carried symbolically and cross-checked at a value (it once threw Unknown variable)", () => {
    const v = run("double integral a x y over x from 0 to 1, y from 0 to 1");
    expect(v.lines[0].text).toBe("= a/4");
    expect(v.caveats.join(" ")).toMatch(/a is a parameter, carried symbolically; the numerical cross-check used a = 0\.73/);
  });
  it("dx dy are refused as differentials, not read as parameters", () => {
    expect(run("double integral x*y dx dy over x from 0 to 1, y from 0 to 1").caveats[0]).toMatch(/dx, dy read as variables here/);
  });
  it("the same variable twice is refused", () => {
    expect(run("double integral x over x from 0 to 1, x from 0 to 1").caveats[0]).toMatch(/integrated twice/);
  });
  it.each([
    ["double integral 1/x over x from -1 to 1, y from 0 to 1", /not finite at x ≈ 0/],
    ["double integral tan(x) over x from 0 to pi, y from 0 to 1", /singular at x ≈ 1\.571.*\(cos\(x\) = 0\)/],
    ["double integral 1/(1 - x) over x from 0 to 2, y from 0 to 1", /not finite at x ≈ 1/],
    ["double integral sec(x)^2 over x from 0 to pi, y from 0 to 1", /cos\(x\) = 0/],
  ])("%s is refused as improper (it once came back = 0, Exact)", (q, why) => {
    const v = run(q);
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(why);
  });
  it("1/x over (0, 1) (no closed form, divergent) is refused for non-convergence, not shown ≈ 7.95", () => {
    const v = run("double integral 1/x over x from 0 to 1, y from 0 to 1");
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/has not converged/);
  });
  it("1/sqrt(x) over (0, 1): an integrable endpoint singularity is accepted by convergence = 2", () => {
    expect(run("double integral 1/sqrt(x) over x from 0 to 1, y from 0 to 1").lines[0].text).toBe("= 2");
  });
  it("a bound of e folds to a decimal, which is then shown as numeric, never as Exact", () => {
    const v = run("double integral x over x from 0 to e, y from 0 to 1");
    expect(v.lines[0].text).toMatch(/^≈ 3\.694528049\s+\(numeric\)/);
    expect(v.caveats.join(" ")).not.toMatch(/^Exact/);
  });
  it("numerical values are shown to the digits the convergence estimate allows (π/2 once showed 1.5708572 to eight)", () => {
    const v = run("double integral 1 over y from 0 to sqrt(1 - x^2), x from -1 to 1");
    expect(v.lines[0].text).toMatch(/^≈ 1\.57(1|08)\d*\s+\(numeric\)/);
    expect(v.caveats[0]).toMatch(/about \d significant figures \(estimated error/);
  });
  it("polar area is still exact: r dr dθ over the unit disc = π", () => {
    expect(run("double integral r over r from 0 to 1, theta from 0 to 2 pi").lines[0].text).toBe("= pi");
  });
});

describe("vector fields live in x, y, z; other letters are constants", () => {
  it.each([
    ["divergence (a x, b y)", /^div F = a \+ b$/],
    ["divergence (k x, k y, k z)", /^div F = 3\*k$/],
    ["curl (a y, b x, 0)", /^curl F = \(0, 0, -a \+ b\)$/],
    ["curl (0, 0, B)", /^curl F = \(0, 0, 0\)$/],
    ["potential (k x, k y)", /^φ = k\*x\^2\/2 \+ k\*y\^2\/2 \+ C$/],
    ["potential (a, b)", /^φ = a\*x \+ b\*y \+ C$/],
  ])("%s", (q, re) => {
    const v = run(q);
    expect(v.lines[0].text).toMatch(re);
    expect(text(q)).not.toMatch(/undefined/);
    expect(v.caveats.join(" ")).toMatch(/treated as constant/);
  });
  it("a field singular on the segment, or a potential infinite at an end, is refused", () => {
    expect(run("line integral (1/x, 1/y) from (-1,-1) to (1,1)").caveats[0]).toMatch(/singular on the straight segment .* \(at \(0, 0\)\)/);
    expect(run("line integral (x/(x^2+y^2), y/(x^2+y^2)) from (1,0) to (0,0)").caveats[0]).toMatch(/not finite at an end point/);
    expect(run("line integral (2 x y, x^2) from (0,0) to (1,2)").lines[0].text).toBe("= 2");
  });
});

describe("evaluation at a point where f or ∇f is undefined is refused", () => {
  it.each([
    "gradient x/y at (1, 0)",
    "hessian 1/(x y) at (0, 0)",
    "gradient sqrt(x) + y at (-1, 0)",
    "gradient x^y at (0, 0)",
    "gradient abs(x) + y at (0, 0)",
  ])("%s", (q) => {
    const v = run(q);
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/not defined at/);
  });
  it("an overflowing direction is refused rather than D_u f = 2e+200/sqrt(Infinity)", () => {
    const v = run("directional derivative x*y at (1,1) in direction (1e200, 1e200)");
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/overflowed/);
  });
});

describe("names", () => {
  it("2xy on its own is a fused name (the letters are coordinate letters)", () => {
    expect(run("gradient x^2 + 2xy").caveats[0]).toMatch(/xy was read as ONE variable/);
    expect(run("gradient 2xy").caveats[0]).toMatch(/xy was read as ONE variable/);
  });
  it("prose is not a verb", () => {
    expect(tryMultivar("grad school applications")).toBeNull();
    expect(tryMultivar("del key")).toBeNull();
    expect(tryMultivar("critical points of the function")).toBeNull();
  });
  it("f(x,y) = is a label", () => {
    expect(run("gradient f(x,y) = x^2 y").lines[0].text).toMatch(/^∇f = \(2\*x\*y, x\^2\)/);
  });
  it("ln(e) is folded: e^x differentiates to exp(x), not 1*exp(x) or ln(e)*exp(x)", () => {
    expect(run("gradient e^x + pi*y").lines[1].text).toBe("f_x = exp(x)");
  });
});

describe("Lagrange honesty", () => {
  it("f constant on the constraint: one value, no distinct max and min, short list", () => {
    const v = run("minimize x^2 + y^2 subject to x^2 + y^2 = 1");
    expect(v.lines.some((l) => /at every candidate found/.test(l.text))).toBe(true);
    expect(text("minimize x^2 + y^2 subject to x^2 + y^2 = 1")).not.toMatch(/Maximum f/);
    expect(v.lines.length).toBeLessThanOrEqual(7);
  });
  it("a constant f is refused by name", () => {
    expect(run("lagrange 5 subject to x^2 + y^2 = 1").caveats[0]).toMatch(/f is a constant/);
  });
  it("a parameter in f but not in the constraint is refused by name, not optimised over", () => {
    expect(run("lagrange a x + y subject to x^2 + y^2 = 1").caveats[0]).toMatch(/a is not a coordinate letter/);
  });
  it("ties are stated in the verdict line", () => {
    expect(text("lagrange x^2 y subject to x^2 + y^2 = 3")).toMatch(/Maximum f = 2 at \(sqrt\(2\), 1\) and \(-sqrt\(2\), 1\)/);
  });
});

describe("critical-point numerics", () => {
  it("underflow 'solutions' far out under exp(−r²) are discarded as flat, and the genuine points stand", () => {
    const t = text("critical points exp(-x^2 - y^2) (x^2 + 2 y^2)");
    expect(t).toMatch(/\(0, 1\): local maximum/);
    expect(t).toMatch(/\(1, 0\): saddle point/);
    expect(cav("critical points exp(-x^2 - y^2) (x^2 + 2 y^2)")).not.toMatch(/CURVE/);
  });
  it("x⁴ + y⁴ + z⁴: the isolated minimum at the origin is reported INCONCLUSIVE, not refused as a curve", () => {
    expect(text("critical points x^4 + y^4 + z^4")).toMatch(/\(0, 0, 0\): INCONCLUSIVE/);
    expect(text("critical points x^2 + y^2 + exp(-x^2 - y^2)")).toMatch(/\(0, 0\): INCONCLUSIVE/);
  });
});

// ---------------------------------------------------------------------------
// Second independent pass (336 probes) + the author's follow-up probe.
// ---------------------------------------------------------------------------

describe("second pass: integrals", () => {
  it("a pole in the OUTER variable is caught (the sign tracker once reset per inner sweep → '= ln(7/10) − ln(−3/10), Exact')", () => {
    const v = run("double integral 1/(y - 0.3) over x from 0 to 1, y from 0 to 1");
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/pole .* \(y - 0\.3 changes sign\)/);
    expect(run("triple integral 1/(z - 0.3) over x from 0 to 1, y from 0 to 1, z from 0 to 1").caveats[0]).toMatch(/z - 0\.3 changes sign/);
  });
  it("an even-power pole is caught by name through its base, not by the slow quadrature fallback", () => {
    const t = Date.now();
    expect(run("double integral 1/(y - 0.3)^2 over x from 0 to 1, y from 0 to 1").caveats[0]).toMatch(/y - 0\.3 changes sign/);
    expect(run("double integral 1/((x-0.3)*(y-0.6)) over x from 0 to 1, y from 0 to 1").caveats[0]).toMatch(/changes sign/);
    expect(Date.now() - t).toBeLessThan(1500);
  });
  it("the triple integral of 1/sqrt(x) over the unit cube = 2 (an integrable endpoint singularity, judged by convergence)", () => {
    expect(run("triple integral 1/sqrt(x) over x from 0 to 1, y from 0 to 1, z from 0 to 1").lines[0].text).toBe("= 2");
  });
  it("a slowly converging numeric integral is refused with an honest reason and the extrapolated value", () => {
    // v2.136.0: 1/sqrt(1 - x^2) — the integrand this pin used through v2.135 —
    // now has an exact antiderivative (asin), and docs/SCOPE-SYMBOLIC-BATCH.md
    // §D ("Definite and double integrals": ∫₀¹ → pi/2) makes it an ANSWER; that
    // pin moved to the test below. The intent (no closed form + an endpoint
    // singularity → refused, with the extrapolated value) keeps a twin with no
    // elementary antiderivative: ∫₀¹ cos(x)/√(1 − x²) dx = (π/2)·J₀(1) ≈ 1.2020.
    // (The pi/2 answer itself is pinned in multivarLeftovers.test.ts.)
    const v = run("double integral cos(x)/sqrt(1 - x^2) over x from 0 to 1, y from 0 to 1");
    expect(v.lines).toHaveLength(0);
    expect(v.caveats[0]).toMatch(/converges too slowly .* extrapolated ≈ 1\.20/);
    expect(v.caveats[0]).not.toMatch(/likely improper/);
  });
  it("numeric digits come from the convergence estimate: 1/sqrt(x²+y²) shows 3 figures, exp(−x²) seven", () => {
    expect(run("double integral 1/sqrt(x^2 + y^2) over x from 0 to 1, y from 0 to 1").lines[0].text).toMatch(/^≈ 1\.76\s+\(numeric\)/);
    expect(run("double integral exp(-x^2) over x from 0 to 1, y from 0 to 1").lines[0].text).toMatch(/^≈ 0\.74682\d*\s+\(numeric\)/);
  });
  it("x/(1+x²) over (−1, 1) is exactly 0, and a removable endpoint 0/0 (sin(x)/x from 0) is accepted", () => {
    expect(run("double integral x/(1 + x^2) over x from -1 to 1, y from 0 to 1").lines[0].text).toBe("= 0");
    expect(run("double integral sin(x)/x over x from 0 to 1, y from 0 to 1").lines[0].text).toMatch(/^≈ 0\.94608/);
  });
});

describe("second pass: names, parameters, symbols", () => {
  it("subscripted names are variables, not prose", () => {
    expect(run("gradient x_1^2 + x_2^2").lines[0].text).toMatch(/^∇f = \(2\*x_1, 2\*x_2\)/);
    expect(text("critical points x_1^2 + x_2^2 - 2 x_1")).toMatch(/\(1, 0\): local minimum/);
    expect(run("double integral x_1 over x_1 from 0 to 1, x_2 from 0 to 1").lines[0].text).toBe("= 1/2");
    expect(run("gradient k_B T").lines.length).toBeGreaterThan(0);
  });
  it("xyz is a fused name (refused by name), not prose", () => {
    expect(run("gradient xyz").caveats[0]).toMatch(/xyz was read as ONE variable/);
  });
  it("symbolic end points and parameters in a line integral keep the symbolic answer", () => {
    expect(run("line integral (x, y) from (a, b) to (c, d)").lines[0].text).toBe("= -a^2/2 - b^2/2 + c^2/2 + d^2/2");
    expect(run("line integral (a x, a y) from (0,0) to (1,1)").lines[0].text).toBe("= a");
    expect(run("line integral (1/x, 1/y) from (1,1) to (2,2)").lines[0].text).toBe("= 2*ln(2)");
  });
  it("a symbolic direction gives the closed form", () => {
    expect(run("directional derivative x^2 + y^2 at (1, 1) in direction (a, b)").lines[0].text).toBe("D_u f(1, 1) = (2*a + 2*b)/sqrt(a^2 + b^2)");
    expect(run("directional derivative x^2 + y^2 at (1, 1) in direction (cos(t), sin(t))").lines.length).toBeGreaterThan(0);
  });
  it("a field with none of x, y, z is refused by name, never answered 0", () => {
    for (const q of ["divergence (u, v)", "divergence (r cos(theta), r sin(theta))", "curl (r cos(theta), r sin(theta))"]) {
      const v = run(q);
      expect(v.lines).toHaveLength(0);
      expect(v.caveats[0]).toMatch(/none of them appear/);
    }
    expect(run("divergence (st x, y)").caveats[0]).toMatch(/st was read as ONE variable/);
  });
  it("parameters in critical points and in a constraint are refused by name", () => {
    expect(run("critical points x^2 + a y^2").caveats[0]).toMatch(/a is not a coordinate letter/);
    expect(run("lagrange x y subject to a x + b y = 1").caveats[0]).toMatch(/a, b are not a coordinate letter/);
  });
  it("sin(x) = y is not a label; f(x,y) = works for Lagrange too", () => {
    expect(tryMultivar("gradient sin(x) = y")).toBeNull();
    expect(text("lagrange f(x,y) = x y subject to x^2 + y^2 = 1")).toMatch(/Maximum f = 1\/2/);
  });
});

describe("second pass: critical points", () => {
  it("exp(−x²) + y²: the origin IS a critical point (a product's roots are the union of its factors'; exp never vanishes)", () => {
    const t = Date.now();
    expect(text("critical points exp(-x^2) + y^2")).toMatch(/\(0, 0\): saddle point, f = 1/);
    expect(Date.now() - t).toBeLessThan(1000);
  });
  it("trig elimination is capped nearest the origin and fast (1,270 roots once took 13 s and showed x ≈ 1000π first)", () => {
    const t = Date.now();
    const v = run("critical points sin(x)^2 + y^2");
    expect(Date.now() - t).toBeLessThan(1500);
    expect(v.lines[1].text).toMatch(/^\(0, 0\): local minimum/);
    expect(v.lines[2].text).toMatch(/^\(-?pi\/2, 0\): saddle point/);
    expect(v.caveats.join(" ")).toMatch(/NOT a complete list/);
  });
  it("an exact D of 4e-16 is not 'zero'", () => {
    expect(text("critical points 1e-8 x^2 + 1e-8 y^2")).toMatch(/\(0, 0\): local minimum/);
    expect(text("critical points 1e-8 (x^2 - y^2)")).toMatch(/\(0, 0\): saddle point/);
  });
  it("x y exp(−x²−y²): the four ±√2/2 extrema are exact (sqrt(2)³ and exp(a)² now fold)", () => {
    const t = text("critical points x y exp(-x^2 - y^2)");
    expect(t).toMatch(/\(sqrt\(2\)\/2, sqrt\(2\)\/2\): local maximum, f = exp\(-1\)\/2/);
    expect(t).toMatch(/\(0, 0\): saddle point/);
  });
});
