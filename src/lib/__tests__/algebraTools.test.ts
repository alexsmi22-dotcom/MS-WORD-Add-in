// Finite sums, algebra verbs, and power isolation (v2.111.0) — oracle tests.

import { trySum, tryAlgebraVerb } from "../algebraTools";
import { solveEquation, parseExpr, evalAst } from "../solve";

describe("finite sums — closed forms, exact", () => {
  test("the classics", () => {
    expect(trySum("sum of 1 to 100")!.display).toBe("5050");
    expect(trySum("sum k from 1 to 100")!.display).toBe("5050");
    expect(trySum("sum k^2 from 1 to 10")!.display).toBe("385");
    expect(trySum("sum k^3 from 1 to 20")!.display).toBe("44100"); // = (210)²
  });

  test("symbolic upper bounds answer the formula", () => {
    expect(trySum("sum k from 1 to n")!.display).toBe("n*(n + 1)/2");
    expect(trySum("sum k^2 from 1 to n")!.display).toBe("n*(n + 1)*(2*n + 1)/6");
    expect(trySum("sum k^3 from 1 to n")!.display).toBe("(n*(n + 1)/2)^2");
    // …and each formula EVALUATES to the exact value.
    for (const [expr, n, want] of [
      ["n*(n + 1)/2", 100, 5050],
      ["n*(n + 1)*(2*n + 1)/6", 10, 385],
      ["(n*(n + 1)/2)^2", 20, 44100],
    ] as [string, number, number][]) {
      expect(evalAst(parseExpr(expr), { n })).toBe(want);
    }
  });

  test("shifted and negative bounds handled exactly", () => {
    expect(trySum("sum k from 5 to 10")!.display).toBe("45");
    expect(trySum("sum k^2 from -3 to 3")!.display).toBe("28");
    expect(trySum("sum of 10 to 2")!.display).toBe("0"); // empty sum, by convention, said so
    expect(trySum("sum of 10 to 2")!.steps.join(" ")).toMatch(/EMPTY sum/);
  });

  test("geometric: numeric exact, symbolic formula, r ≠ 1 stated", () => {
    expect(trySum("sum 2^k from 0 to 10")!.display).toBe("2047");
    const g = trySum("sum r^k from 0 to n")!;
    expect(g.display).toBe("(r^(n + 1) - 1)/(r - 1)");
    expect(g.caveats.join(" ")).toMatch(/r ≠ 1/);
    // Fractional base sums exactly.
    const half = trySum("sum 1/2^k from 0 to 3");
    if (half && half.display !== "not read") {
      expect(half.display).toBe("15/8");
    }
  });

  test("the harmonic series is refused BY NAME", () => {
    const h = trySum("sum 1/k from 1 to n")!;
    expect(h.display).toBe("no elementary closed form");
    expect(h.steps.join(" ")).toMatch(/ln\(n\)/);
  });

  test("non-sum text returns null (no theft from the equation solver)", () => {
    expect(trySum("x^2 = 4")).toBeNull();
    expect(trySum("summary of x")).toBeNull();
  });
});

describe("algebra verbs — verified by multiplying back", () => {
  test("factor: quadratics, cubics, common factors, multiplicity", () => {
    expect(tryAlgebraVerb("factor x^2 - 5*x + 6")!.lines[0].text).toBe("(x - 2)*(x - 3)");
    expect(tryAlgebraVerb("factor x^3 - 6*x^2 + 11*x - 6")!.lines[0].text).toBe("(x - 1)*(x - 2)*(x - 3)");
    expect(tryAlgebraVerb("factor 2*x^2 + 4*x")!.lines[0].text).toBe("2*x*(x + 2)");
    expect(tryAlgebraVerb("factor x^3 - 3*x^2 + 3*x - 1")!.lines[0].text).toBe("(x - 1)^3");
  });

  test("factor claims only RATIONAL factorisation, and says so", () => {
    const r = tryAlgebraVerb("factor x^2 - 2")!;
    expect(r.lines[0].text).toBe("x^2 - 2");
    expect(r.caveats.join(" ")).toMatch(/No RATIONAL roots/);
    const quart = tryAlgebraVerb("factor x^4 - 1")!;
    expect(quart.lines[0].text).toBe("(x - 1)*(x + 1)*(x^2 + 1)");
    expect(quart.caveats.join(" ")).toMatch(/RATIONAL/);
  });

  test("expand: standard form, exact coefficients", () => {
    expect(tryAlgebraVerb("expand (x+1)^3")!.lines[0].text).toBe("x^3 + 3*x^2 + 3*x + 1");
    expect(tryAlgebraVerb("expand (x-2)*(x+3)^2")!.lines[0].text).toBe("x^3 + 4*x^2 - 3*x - 18");
    expect(tryAlgebraVerb("expand (x/2 + 1)^2")!.lines[0].text).toBe("1/4*x^2 + x + 1");
  });

  test("simplify routes to the CAS canonical form with the honest caveat", () => {
    const r = tryAlgebraVerb("simplify (x^2-1)/(x-1)")!;
    expect(r.lines[0].text).toBe("x + 1");
    expect(r.caveats.join(" ")).toMatch(/canonical/);
  });

  test("every factored/expanded result equals the original at sample points", () => {
    for (const verb of [
      "factor x^2 - 5*x + 6", "factor x^4 - 1", "factor 6*x^2 - 7*x - 3",
      "expand (x+1)^3", "expand (2*x-1)*(x+4)",
    ]) {
      const r = tryAlgebraVerb(verb)!;
      expect(r.lines.length).toBe(1);
      const original = verb.replace(/^(factor|expand)\s+/, "");
      for (const s of [0.3, 1.7, -2.2]) {
        const a = evalAst(parseExpr(original), { x: s });
        const b = evalAst(parseExpr(r.lines[0].text), { x: s });
        expect(b).toBeCloseTo(a, 8);
      }
    }
  });

  test("refusals are named: multivariate, non-polynomial, unparseable", () => {
    expect(tryAlgebraVerb("factor x*y + y")!.caveats.join(" ")).toMatch(/ONE variable/);
    expect(tryAlgebraVerb("factor sin(x)")!.caveats.join(" ")).toMatch(/POLYNOMIAL/);
    expect(tryAlgebraVerb("nonsense x^2")).toBeNull();
  });
});

describe("defects found by the independent adversarial pass (v2.111.0), pinned", () => {
  test("1: huge negative bounds answer instantly — closed form, no loop", () => {
    const t0 = Date.now();
    const r = trySum("sum k from -1000000000 to 0")!;
    expect(Date.now() - t0).toBeLessThan(200); // was ~a minute of loop
    // −Σ(1..1e9) = −(1e9·(1e9+1)/2)
    expect(r.display).toBe("-500000000500000000");
    const s2 = trySum("sum k^2 from -100000 to 5")!;
    // brute oracle on the small mirror: Σk² −100000..5 = Σ1..100000 + Σ0..5
    expect(s2.display).toBe((BigInt(100000) * 100001n * 200001n / 6n + 55n).toString());
  });

  test("2+4: malformed or zero-dividing geometric bases refuse by name", () => {
    expect(trySum("sum 1/0^k from 0 to 3")!.caveats.join(" ")).toMatch(/divides by zero/);
    const bad = trySum("sum 2.5.3^k from 0 to 2")!;
    expect(bad.display).toBe("not read");
    expect(bad.caveats.join(" ")).toMatch(/not a number/);
  });

  test("3: variables NAMED sum/factor keep the equation solver", () => {
    expect(trySum("sum = 4")).toBeNull();
    expect(trySum("sum + 2 = 4")).toBeNull();
    expect(tryAlgebraVerb("factor = 2")).toBeNull();
    expect(tryAlgebraVerb("expand + 1 = 2")).toBeNull();
    // …so the solver answers them.
    expect(solveEquation("sum = 4")!.roots[0].display).toBe("4");
    expect(solveEquation("factor = 2")!.roots[0].display).toBe("2");
  });

  test("5: big exact expansions are shown with the precision caveat, not refused", () => {
    const r = tryAlgebraVerb("expand (x+1)^60")!;
    expect(r.lines).toHaveLength(1);
    // Binomial spot-checks: C(60,1) = 60, C(60,2) = 1770, C(60,30) exact digits.
    expect(r.lines[0].text).toContain("60*x^59");
    expect(r.lines[0].text).toContain("1770*x^58");
    expect(r.lines[0].text).toContain("118264581564861424"); // C(60,30), exact
    expect(r.caveats.join(" ")).toMatch(/2⁵³/);
    // Modest expansions stay caveat-free.
    expect(tryAlgebraVerb("expand (x+1)^3")!.caveats).toEqual([]);
  });

  test("cosmetics: a −1 lead factors as a bare minus; trivial conditions are silent", () => {
    expect(tryAlgebraVerb("factor -x^2 + 1")!.lines[0].text).toBe("-(x - 1)*(x + 1)");
    const sphere = solveEquation("V = (4/3)*pi*r^3", "r")!;
    expect(sphere.caveats.join(" ")).not.toMatch(/pi.*≠ 0/);
  });

  test("simplify with a division carries the domain caveat", () => {
    const r = tryAlgebraVerb("simplify (x^2-1)/(x-1)")!;
    expect(r.caveats.join(" ")).toMatch(/undefined \(0\/0\)/);
  });
});

describe("power isolation in symbolic rearrangement", () => {
  test("the sphere: V = (4/3)πr³ solves for r as a single cube root", () => {
    const r = solveEquation("V = (4/3)*pi*r^3", "r")!;
    expect(r.method).toBe("exact (symbolic rearrangement)");
    expect(r.roots).toHaveLength(1);
    expect(r.roots[0].display).toContain("cbrt");
    expect(r.caveats.join(" ")).toMatch(/odd power has exactly ONE real root/i);
    // Verify: with V = 36π the radius is 3.
    const val = evalAst(parseExpr(r.roots[0].display), { V: 36 * Math.PI });
    expect(val).toBeCloseTo(3, 9);
  });

  test("Stefan–Boltzmann: E = σT⁴ gives the ± pair with the ≥ 0 condition", () => {
    const r = solveEquation("E = s*T^4", "T")!;
    expect(r.roots).toHaveLength(2);
    expect(r.caveats.join(" ")).toMatch(/even power is never negative/);
    const val = evalAst(parseExpr(r.roots[0].display), { E: 16, s: 1 });
    expect(val).toBeCloseTo(2, 9);
  });

  test("odd powers keep negative right-hand sides real", () => {
    const r = solveEquation("V = a^3", "a")!;
    const val = evalAst(parseExpr(r.roots[0].display), { V: -8 });
    expect(val).toBeCloseTo(-2, 9);
  });

  test("numeric-only power equations still go to the complete root finder", () => {
    // x^3 = 8 must keep ALL its roots (one real, two complex) — the monomial
    // path is for SYMBOLIC rearrangement, not a downgrade of Durand–Kerner.
    // v2.136.0 (§D): rational coefficients now reach the exact engine, so the
    // three roots are exact — still all three, still no downgrade to the
    // symbolic path. The pin was "complete (all roots)".
    const r = solveEquation("x^3 = 8")!;
    expect(r.roots).toHaveLength(3);
    expect(r.method).toBe("exact (factored over ℚ)");
    expect(r.roots.map((x) => x.display)).toEqual(["2", "-1 - sqrt(3)*i", "-1 + sqrt(3)*i"]);
  });

  test("a middle term disqualifies the monomial path honestly", () => {
    // x^3 + x = V is not a monomial isolation; with another symbol it stays
    // an honest refusal rather than a wrong root.
    const r = solveEquation("V = a^3 + a", "a")!;
    expect(r.method).toBe("unsolved");
  });
});
