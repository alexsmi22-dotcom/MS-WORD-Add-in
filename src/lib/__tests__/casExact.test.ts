// v2.136.0 — CasOptions.exactRadicals (docs/SCOPE-SYMBOLIC-BATCH.md §A finding 2,
// §B2 "The float residue", §E.5).
//
// Default OFF: every existing caller keeps float folding of functions of
// constants. ON: sqrt/cbrt/n-th roots of rationals are algebraic atoms reduced
// modulo atom^k = radicand, sin/cos/tan at rational multiples of pi fold where
// the value is a known radical, other functions of constants stay symbolic, and
// a nested sqrt denests only when the denested form squares back exactly.

import { casSimplify, exprEqual } from "../cas";
import { parseExpr, evalAst, format } from "../solve";

const P = parseExpr;
const X = { exactRadicals: true };
const SX = (src: string): string => format(casSimplify(P(src), X));
const EQX = (a: string, b: string): boolean | null => exprEqual(P(a), P(b), X);

describe("default mode is unchanged (opt-in only)", () => {
  it("sqrt(2) still folds to a decimal and cbrt(2)^3 - 2 still leaves float residue", () => {
    expect(format(casSimplify(P("sqrt(2)")))).toMatch(/^1\.414/);
    expect(format(casSimplify(P("cbrt(2)^3 - 2")))).not.toBe("0");
    expect(exprEqual(P("cbrt(2)^3"), P("2"))).toBe(false);
  });
});

describe("§D: the float-residue identities are exactly 0", () => {
  it("simplify cbrt(2)^3 - 2 → 0", () => {
    expect(SX("cbrt(2)^3 - 2")).toBe("0");
  });
  it("simplify (sqrt(2)+sqrt(3))^4 - 10*(sqrt(2)+sqrt(3))^2 + 1 → 0", () => {
    expect(SX("(sqrt(2)+sqrt(3))^4 - 10*(sqrt(2)+sqrt(3))^2 + 1")).toBe("0");
  });
  it("exprEqual(cbrt(2)^3, 2) is true in exact mode", () => {
    expect(EQX("cbrt(2)^3", "2")).toBe(true);
    expect(EQX("sqrt(3)^3", "3*sqrt(3)")).toBe(true);
  });
});

describe("radicals of rationals", () => {
  const EQUAL: [string, string][] = [
    ["sqrt(2)*sqrt(2)", "2"],
    ["sqrt(8)", "2*sqrt(2)"],
    ["sqrt(6)", "sqrt(2)*sqrt(3)"],
    ["sqrt(12)*sqrt(3)", "6"],
    ["cbrt(4)", "cbrt(2)^2"],
    ["cbrt(16)", "2*cbrt(2)"],
    ["cbrt(-2)", "-cbrt(2)"],
    ["cbrt(1/2)", "cbrt(4)/2"],
    ["sqrt(1/2)", "sqrt(2)/2"],
    ["1/sqrt(2)", "sqrt(2)/2"],
    ["1/(1 + sqrt(2))", "sqrt(2) - 1"],
    ["(2^(1/4))^4", "2"],
    ["2^(3/2)", "2*sqrt(2)"],
    ["sqrt(0.5)", "sqrt(2)/2"],
    ["(1 + sqrt(5))^2/4 - (1 + sqrt(5))/2", "1"], // golden ratio: φ² − φ = 1
  ];
  for (const [a, b] of EQUAL) {
    it(`${a} ≡ ${b}`, () => {
      expect(EQX(a, b)).toBe(true);
      expect(Math.abs(evalAst(P(a), {}) - evalAst(P(b), {}))).toBeLessThan(1e-12);
    });
  }
  const UNEQUAL: [string, string][] = [
    ["sqrt(2)", "1.41421356237"],
    ["sqrt(2) + sqrt(3)", "sqrt(5)"],
    ["sqrt(6)", "sqrt(2) + sqrt(3)"],
    ["cbrt(2)", "sqrt(2)"],
    ["cbrt(2)^2", "sqrt(2)"],
    ["2^(1/4)", "sqrt(2)"],
    ["sqrt(2)*cbrt(2)", "2"],
  ];
  for (const [a, b] of UNEQUAL) {
    it(`${a} ≢ ${b}`, () => {
      expect(EQX(a, b)).toBe(false);
    });
  }
  it("displays merge the prime split back and rationalise", () => {
    expect(SX("sqrt(2)*sqrt(3)")).toBe("sqrt(6)");
    expect(SX("sqrt(8)")).toBe("2*sqrt(2)");
    expect(SX("cbrt(1/2)")).toBe("cbrt(4)/2");
    expect(SX("1/sqrt(2)")).toBe("sqrt(2)/2");
    expect(SX("1/(1 + sqrt(2))")).toBe("sqrt(2) - 1");
    expect(SX("cbrt(-27)")).toBe("-3");
  });
  it("every exact display re-parses to the same value", () => {
    for (const src of ["sqrt(6)/3 + cbrt(12)", "1/(2 - sqrt(3))", "sqrt(50)*cbrt(54)", "2^(5/4)"]) {
      const out = SX(src);
      expect(Math.abs(evalAst(P(out), {}) - evalAst(P(src), {}))).toBeLessThan(1e-9);
      expect(EQX(out, src)).toBe(true);
    }
  });
  it("sqrt of a negative constant is refused (null), never a silent real", () => {
    expect(EQX("sqrt(-2)", "0")).toBeNull();
  });
});

describe("trig at rational multiples of pi; other constants stay symbolic", () => {
  const T: [string, string][] = [
    ["cos(pi/3)", "1/2"],
    ["sin(pi/4)", "sqrt(2)/2"],
    ["cos(2*pi/3)", "-1/2"],
    ["sin(pi/6)", "1/2"],
    ["cos(5*pi/6)", "-sqrt(3)/2"],
    ["tan(pi/6)", "sqrt(3)/3"],
    ["sin(7*pi/4)", "-sqrt(2)/2"],
    ["cos(pi)", "-1"],
    ["acos(-1/2)", "2*pi/3"],
    ["asin(1/2)", "pi/6"],
    ["atan(1)", "pi/4"],
    ["exp(0)", "1"],
    ["ln(1)", "0"],
  ];
  for (const [a, b] of T) {
    it(`${a} = ${b}`, () => {
      expect(EQX(a, b)).toBe(true);
    });
  }
  it("cos(pi/9) and ln(2) are kept symbolic, not folded to floats", () => {
    expect(SX("cos(pi/9)")).toBe("cos(pi/9)");
    expect(SX("ln(2)")).toBe("ln(2)");
    expect(EQX("ln(2)", "0.6931471805599453")).toBe(false);
  });
  it("the triple-angle identity holds at pi/9 (4cos³ − 3cos = cos 3φ = 1/2) — not derivable, so false, NOT a refutation", () => {
    // Pinned so a caller never reads this `false` as "the identity fails".
    expect(EQX("4*cos(pi/9)^3 - 3*cos(pi/9)", "1/2")).toBe(false);
    expect(Math.abs(4 * Math.cos(Math.PI / 9) ** 3 - 3 * Math.cos(Math.PI / 9) - 0.5)).toBeLessThan(1e-15);
  });
});

describe("review cosmetics: what provably comes out of a radical (exact mode)", () => {
  it("sqrt(2*2*pi)/2 → sqrt(pi); sqrt(x/4) → sqrt(x)/2; cbrt(8*y) → 2*cbrt(y)", () => {
    expect(SX("sqrt(2*2*pi)/2")).toBe("sqrt(pi)");
    expect(EQX("sqrt(x/4)", "sqrt(x)/2")).toBe(true);
    expect(SX("cbrt(8*y)")).toBe("2*cbrt(y)");
  });
  it("sqrt(ln(2)^2) → ln(2) (ln 2 > 0 provably); sqrt(ln(1/2)^2) → -ln(1/2); sqrt(x^2) stays (it is |x|)", () => {
    expect(SX("sqrt(ln(2)^2)")).toBe("ln(2)");
    expect(SX("sqrt(ln(1/2)^2)")).toBe("-ln(1/2)");
    expect(SX("sqrt(x^2)")).toBe("sqrt(x^2)");
    expect(SX("sqrt(x^4)")).toBe("x^2");
  });
  it("integer arithmetic in exponents folds: 2^(3 - 2) → 2, 3*2^(3-1)*ln(2) → 12*ln(2)", () => {
    expect(SX("2^(3 - 2)")).toBe("2");
    expect(SX("3*2^(3-1)*ln(2)")).toBe("12*ln(2)");
  });
  it("default mode is untouched: sqrt(4*pi) keeps its shape", () => {
    expect(format(casSimplify(P("sqrt(4*pi)")))).toBe("sqrt(4*pi)");
  });
});

describe("nested radicals denest only when provably equal", () => {
  it("sqrt(5 + 2*sqrt(6)) → sqrt(2) + sqrt(3)", () => {
    expect(SX("sqrt(5 + 2*sqrt(6))")).toBe("sqrt(2) + sqrt(3)");
  });
  it("sqrt(3 - 2*sqrt(2)) → sqrt(2) - 1 (the positive root)", () => {
    expect(SX("sqrt(3 - 2*sqrt(2))")).toBe("sqrt(2) - 1");
  });
  it("sqrt(2 + sqrt(3)) = (sqrt(6) + sqrt(2))/2", () => {
    expect(EQX("sqrt(2 + sqrt(3))", "(sqrt(6) + sqrt(2))/2")).toBe(true);
  });
  it("sqrt(1 + sqrt(2)) does not denest, but still squares back exactly", () => {
    expect(SX("sqrt(1 + sqrt(2))")).toBe("sqrt(sqrt(2) + 1)");
    expect(EQX("sqrt(1 + sqrt(2))^2", "1 + sqrt(2)")).toBe(true);
    expect(EQX("sqrt(1 + sqrt(2))*sqrt(1 + sqrt(2))", "1 + sqrt(2)")).toBe(true);
  });
});

describe("verifying exact polynomial roots (what Builder A needs)", () => {
  it("x^4 + 4x - 1 at the Ferrari root -sqrt(2)/2 + sqrt(sqrt(2) - 1/2) is exactly 0", () => {
    const r = "(-sqrt(2)/2 + sqrt(sqrt(2) - 1/2))";
    expect(EQX(`${r}^4 + 4*${r} - 1`, "0")).toBe(true);
    // A wrong sign is NOT zero.
    const w = "(sqrt(2)/2 + sqrt(sqrt(2) - 1/2))";
    expect(EQX(`${w}^4 + 4*${w} - 1`, "0")).toBe(false);
  });
  it("x^4 - 10x^2 + 1 at sqrt(3) + sqrt(2) is exactly 0", () => {
    expect(EQX("(sqrt(3)+sqrt(2))^4 - 10*(sqrt(3)+sqrt(2))^2 + 1", "0")).toBe(true);
  });
  it("x^4 - 2 at 2^(1/4), x^3 - 2 at cbrt(2) and at the complex pair's modulus", () => {
    expect(EQX("(2^(1/4))^4 - 2", "0")).toBe(true);
    expect(EQX("cbrt(2)^3 - 2", "0")).toBe(true);
    // |−1/2·cbrt(2) ± sqrt(3)/2·cbrt(2)·i|² = cbrt(2)^2·(1/4 + 3/4)
    expect(EQX("(cbrt(2)/2)^2 + (sqrt(3)/2*cbrt(2))^2", "cbrt(4)")).toBe(true);
  });
  it("Cardano for x^3 - 2x - 5: u³ + v³ = 5 and u³v³ = 8/27 are exact; the root itself is NOT (uv is not derivable)", () => {
    const u = "cbrt(5/2 + sqrt(1929)/18)", v = "cbrt(5/2 - sqrt(1929)/18)";
    expect(EQX(`${u}^3 + ${v}^3`, "5")).toBe(true);
    expect(EQX(`${u}^3 * ${v}^3`, "8/27")).toBe(true);
    // Pinned: false here means "not shown", not "not a root". A certifies Cardano
    // by u³ + v³ = −q and u³v³ = −p³/27 (above) plus a numeric sign check of uv.
    expect(EQX(`(${u} + ${v})^3 - 2*(${u} + ${v}) - 5`, "0")).toBe(false);
    const r = Math.cbrt(5 / 2 + Math.sqrt(1929) / 18) + Math.cbrt(5 / 2 - Math.sqrt(1929) / 18);
    expect(Math.abs(r ** 3 - 2 * r - 5)).toBeLessThan(1e-12);
  });
});
