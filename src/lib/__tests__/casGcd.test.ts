// v2.136.0 — multivariate GCD at the casSimplify output boundary, the
// polyResultant export, and the symbolic-exponent equality fix
// (docs/SCOPE-SYMBOLIC-BATCH.md §B2, §D "GCD", §A findings 6 and 10).
//
// Expected strings are SymPy 1.14 `cancel` results (§D), checked here through
// format(casSimplify(...)) and, independently, BY VALUE at random points — a
// reduced fraction that prints right but is a different function would fail
// the value check.

import { casSimplify, casSimplifyReport, canonicalKey, exprEqual, polyResultant, resultant } from "../cas";
import { parseExpr, evalAst, format, differentiate } from "../solve";
import { tryMultivar } from "../multivar";

const P = parseExpr;
const S = (src: string): string => format(casSimplify(P(src)));

/** Both must agree numerically at several generic points (away from 0/0). */
function sameValue(a: string, b: string): void {
  const pts = [
    { x: 0.7, y: 1.9, a: 2.3, b: -0.4 },
    { x: -1.3, y: 0.45, a: -0.8, b: 1.7 },
    { x: 2.9, y: -2.2, a: 1.1, b: 3.4 },
  ];
  for (const p of pts) {
    const va = evalAst(P(a), p), vb = evalAst(P(b), p);
    expect(Math.abs(va - vb)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(va)));
  }
}

describe("§D GCD table (SymPy cancel)", () => {
  const TABLE: [string, string][] = [
    ["(x^2 - y^2)/(x - y)", "x + y"],
    ["(x^2 + 2*x*y + y^2)/(x + y)", "x + y"],
    ["(x^2 - y^2)/(x^2 - 2*x*y + y^2)", "(x + y)/(x - y)"],
    // SymPy prints a^2 + a*b + b^2; the CAS's long-standing graded-key order
    // within a degree puts a*b first. Same polynomial (checked by value below).
    ["(a^3 - b^3)/(a - b)", "a*b + a^2 + b^2"],
    ["(x*y + x)/(y + 1)", "x"],
    ["(x^4 - y^4)/(x^2 + y^2)", "x^2 - y^2"],
    ["(x^2 - y^2)/(x + y) + y", "x"],
    ["(x^2 - 4*y^2)/(x + 2*y)", "x - 2*y"],
    ["(x^3 + y^3)/(x^2 - x*y + y^2)", "x + y"],
    ["(x^2*y + x*y^2)/(x^2 - y^2)", "x*y/(x - y)"],
    ["(x^2 + x*y - 2*y^2)/(x^2 - y^2)", "(x + 2*y)/(x + y)"],
    ["(x^3*y - x*y^3)/(x^2*y + x*y^2)", "x - y"],
  ];
  for (const [input, want] of TABLE) {
    it(`${input} → ${want}`, () => {
      expect(S(input)).toBe(want);
      sameValue(input, want);
    });
  }

  it("(sin(x)^2 - cos(x)^2)/(sin(x) - cos(x)) → sin(x) + cos(x), atoms as indeterminates", () => {
    const out = casSimplify(P("(sin(x)^2 - cos(x)^2)/(sin(x) - cos(x))"));
    // The CAS orders atoms by key (cos before sin); the value is SymPy's.
    expect(format(out)).toBe("cos(x) + sin(x)");
    expect(exprEqual(out, P("sin(x) + cos(x)"))).toBe(true);
  });

  it("sin² + cos² = 1 is NOT used — (sin(x)^2 + cos(x)^2)/(sin(x)+cos(x)) stays a fraction", () => {
    expect(S("(sin(x)^2 + cos(x)^2)/(sin(x) + cos(x))")).toContain("/");
  });

  it("unchanged twins: (x^2*y - y)/(x*y + y) → x - 1; (x^2 - 1)/(x - 1) → x + 1", () => {
    expect(S("(x^2*y - y)/(x*y + y)")).toBe("x - 1");
    expect(S("(x^2 - 1)/(x - 1)")).toBe("x + 1");
  });

  it("Derivative kind: d/dx (x^2 - y^2)/(x - y) = 1 (was a 0/0-shaped fraction)", () => {
    const d = differentiate("(x^2 - y^2)/(x - y)", "x");
    expect(d).not.toBeNull();
    expect(d!.derivative).toBe("1");
  });
});

describe("casSimplifyReport names what it cancelled, or why it did not", () => {
  it("reports the cancelled factor x - y", () => {
    const r = casSimplifyReport(P("(x^2 - y^2)/(x - y)"));
    expect(format(r.result)).toBe("x + y");
    expect(r.cancelled && format(r.cancelled)).toBe("x - y");
    expect(r.refused).toBeNull();
  });
  it("nothing cancelled → cancelled null, anyCancellation false (the caveat can be dropped)", () => {
    const r = casSimplifyReport(P("(x + y)/(x - y)"));
    expect(r.cancelled).toBeNull();
    expect(r.anyCancellation).toBe(false);
    expect(r.refused).toBeNull();
  });
  it("review pins: sums that cancel to 0 drop their divisor's points → anyCancellation true", () => {
    for (const s of ["(x^2 - y^2)/(x - y) - x - y", "1/x - 1/x", "(3*x - 3)/(18*x + 24) - (1 - x)/(-6*x - 8)"]) {
      expect(casSimplifyReport(P(s)).anyCancellation).toBe(true);
    }
  });
  it("divisors that survive do not raise it: (x-1)/(x-1)^2, 1/x + 1/y, x/pi, 1/(x*y)", () => {
    for (const s of ["(x - 1)/(x - 1)^2", "1/x + 1/y", "x/pi", "1/(x*y)", "x^(-2) + 1"]) {
      expect(`${s}: ${casSimplifyReport(P(s)).anyCancellation}`).toBe(`${s}: false`);
    }
  });
  it("random sweep: A·G/(B·G) − A/B (194 draws) always reports true; the result is defined where the input is not", () => {
    let s = 12345;
    const r = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const lin = (): string => {
      const c = () => Math.floor(r() * 9) - 4;
      return `(${c() || 1}*x + ${c()}*y + ${c() || 2})`;
    };
    for (let i = 0; i < 194; i++) {
      const A = lin(), B = lin(), G = lin();
      const src = `(${A}*${G})/(${B}*${G}) - ${A}/${B}`;
      expect(`${src}: ${casSimplifyReport(P(src)).anyCancellation}`).toBe(`${src}: true`);
    }
  });
  it("a univariate or monomial cancellation inside arithmetic still raises anyCancellation", () => {
    // cancelled is null (the boundary GCD had nothing left to do) — but x = 1 WAS lost.
    const u = casSimplifyReport(P("(x^2 - 1)/(x - 1)"));
    expect(u.cancelled).toBeNull();
    expect(u.anyCancellation).toBe(true);
    expect(casSimplifyReport(P("x*y/x")).anyCancellation).toBe(true);
    expect(casSimplifyReport(P("(x^2 - y^2)/(x - y)")).anyCancellation).toBe(true);
  });
  it("five symbols → refused by name, fraction left unreduced but equal", () => {
    const src = "(a*b - c*d + e)*(a + b)/((a + b)*(c - d))";
    // rfNorm keeps (a+b) on both sides (multi-atom); the cap stops the boundary GCD.
    const r = casSimplifyReport(P(src));
    expect(r.refused).toMatch(/symbol cap/);
    expect(r.cancelled).toBeNull();
    expect(exprEqual(r.result, P(src))).toBe(true);
  });
  it("degree above 12 → refused by name", () => {
    const r = casSimplifyReport(P("(x^13 - y^13)/(x - y)"));
    expect(r.refused).toMatch(/degree cap/);
  });
});

describe("canonicalKey is only as canonical as the capped GCD (§E.6)", () => {
  it("below the cap, a reducible fraction and its reduced form share a key", () => {
    expect(canonicalKey(P("(x^2 - y^2)/(x - y)"))).toBe(canonicalKey(P("x + y")));
  });
  it("above the cap the keys differ — but exprEqual (subtraction to zero) still says equal", () => {
    const big = "(x^13 - y^13)/(x - y)";
    const quotient = Array.from({ length: 13 }, (_, k) => `x^${12 - k}*y^${k}`).join(" + ");
    expect(canonicalKey(P(big))).not.toBe(canonicalKey(P(quotient)));
    expect(exprEqual(P(big), P(quotient))).toBe(true);
  });
});

describe("symbolic-exponent equality (§A finding 6)", () => {
  it("x^y/x ≡ x^(y-1) and x^(y+1) ≡ x*x^y", () => {
    expect(exprEqual(P("x^y/x"), P("x^(y-1)"))).toBe(true);
    expect(exprEqual(P("x^(y+1)"), P("x*x^y"))).toBe(true);
    expect(exprEqual(P("2^(x+3)"), P("8*2^x"))).toBe(true);
  });
  it("the Hessian identity: d/dy (y*x^(y-1)) and d/dx (x^y*ln(x)) agree", () => {
    // f_xy and f_yx of x^y, as the derivative engine prints them.
    const fx = differentiate("x^y", "x")!.derivative;
    const fy = differentiate("x^y", "y")!.derivative;
    const fxy = differentiate(fx, "y")!.derivative;
    const fyx = differentiate(fy, "x")!.derivative;
    expect(exprEqual(P(fxy), P(fyx))).toBe(true);
  });
  it("multivar's own path: hessian x^y at (1, 1) is no longer withheld as asymmetric", () => {
    const r = tryMultivar("hessian x^y at (1, 1)")!;
    const text = r.lines.map((l) => l.text).join("\n");
    expect(text).not.toMatch(/did not agree/);
    expect(text).toContain("H(1, 1) = [[0, 1], [1, 0]]");
  });
  it("does not reshape x^(y/2) or x^(-y), and never claims a false identity", () => {
    expect(exprEqual(P("x^(y/2)"), P("x^y/2"))).toBe(false);
    expect(exprEqual(P("x^(-y)"), P("-x^y"))).toBe(false);
    expect(exprEqual(P("x^(y-1)"), P("x^y"))).toBe(false);
    expect(exprEqual(P("x^(y+1)"), P("x^y + x"))).toBe(false);
    expect(exprEqual(P("x^(y+1/2)"), P("x^y*x"))).toBe(false);
  });
  it("display is unchanged: e^(x+1) and y*x^(y-1) keep their shape", () => {
    expect(S("e^(x+1)")).toBe("e^(x + 1)");
    expect(S("y*x^(y-1)")).toBe("y*x^(y - 1)");
  });
});

describe("polyResultant", () => {
  const R = (a: string, b: string, x: string): string | null => {
    const r = polyResultant(P(a), P(b), x);
    return r ? format(r) : null;
  };
  it("Res(x^2 - 2, x - 1) = -1 (= p(1)) and a common root gives 0", () => {
    expect(R("x^2 - 2", "x - 1", "x")).toBe("-1");
    expect(R("x^2 - 1", "x - 1", "x")).toBe("0");
  });
  it("eliminates x from {x^2 + y^2 = 1, x - y = 0}: 2*y^2 - 1", () => {
    const r = polyResultant(P("x^2 + y^2 - 1"), P("x - y"), "x")!;
    expect(exprEqual(r, P("2*y^2 - 1"))).toBe(true);
  });
  it("Lagrange tangency for x*y on x^2 - y^2 = 1: T = -2(x^2+y^2); Res_x(T, g) has no real root", () => {
    const r = polyResultant(P("-2*(x^2 + y^2)"), P("x^2 - y^2 - 1"), "x")!;
    // Res = 4*(2*y^2 + 1)^2 — positive for every real y.
    expect(exprEqual(r, P("4*(2*y^2 + 1)^2"))).toBe(true);
  });
  it("matches the Sylvester definition on a general cubic/quadratic (symbolic coefficients)", () => {
    // Res(a*x^2 + b*x + c, x - t) = a*t^2 + b*t + c  (deg-1 second argument)
    const r = polyResultant(P("a*x^2 + b*x + c"), P("x - t"), "x")!;
    expect(exprEqual(r, P("a*t^2 + b*t + c"))).toBe(true);
    // Res(p, p') for x^2 + b*x + c is -(b^2 - 4c) times lead conventions: = 4c - b^2
    const d = polyResultant(P("x^2 + b*x + c"), P("2*x + b"), "x")!;
    expect(exprEqual(d, P("4*c - b^2"))).toBe(true);
  });
  it("constants and denominators: Res(3, x^2+1) = 9; Res((x-1)/2, x+1) = (1/2)·Res(x-1, x+1) = 1", () => {
    expect(R("3", "x^2 + 1", "x")).toBe("9");
    expect(R("(x-1)/2", "x + 1", "x")).toBe("1");
  });
  it("refuses: x inside an atom, x in a denominator, Sylvester size > 12", () => {
    expect(polyResultant(P("sin(x) + 1"), P("x"), "x")).toBeNull();
    expect(polyResultant(P("1/x + 1"), P("x"), "x")).toBeNull();
    expect(polyResultant(P("x^7 + y"), P("x^6 + 1"), "x")).toBeNull();
  });
  it("is also exported as `resultant`", () => {
    expect(resultant).toBe(polyResultant);
  });
});
