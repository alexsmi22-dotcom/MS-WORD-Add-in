// EVERY REPORTED ROOT MUST SATISFY THE EQUATION, AND NO REAL ROOT MAY BE LOST.
//
// The defect: `numericRealRoots` accepted any bracketed sign change. Across a POLE
// the function also changes sign — from −∞ to +∞ — so the bisection narrowed onto
// the pole and reported it as a root:
//
//   solveEquation("1/(x-2.25) = 0")  ->  root 2.25, where the LHS is -1.1e12
//   solveEquation("tan(x) = 2")      ->  1176 "roots" ALTERNATING real solutions
//                                        and asymptotes
//
// `1/(x-2) = 0` looked correct only by accident — the scan grid lands exactly on 2,
// so the sign test is skipped. Move the pole off the grid and it reappears, which
// is the signature of a sampling artefact rather than a fix.
//
// This file asserts BOTH halves of the repair, because a guard that fixes the false
// positives by discarding true positives is not a fix:
//
//   1. SOUNDNESS — substitute every returned root back. The residual must be small.
//      This is the check the bisection never made.
//   2. COMPLETENESS — a list of analytically known solutions must still be found.
//      Tightening an acceptance test is exactly how real answers get lost, and
//      that failure is silent.

import { solveEquation } from "../solve";
import { parseExpr, evalAst } from "../solve";

/** |LHS − RHS| at a root, evaluated from the ORIGINAL text. */
function residual(equation: string, at: number, variable = "x"): number {
  const [lhs, rhs] = equation.split("=");
  const f = parseExpr(`(${lhs}) - (${rhs})`);
  return Math.abs(evalAst(f, { [variable]: at }));
}

describe("soundness: every root returned satisfies the equation", () => {
  test.each([
    "tan(x) = 2",
    "sin(x) = 0",
    "sin(x) = 0.5",
    "cos(x) = 1",
    "exp(x) = 2",
    "ln(x) = 1",
    "x*exp(x) = 1",
    "cos(x) = x",
    "sin(x) = x/2",
    "x^3 = 2^x",
    "exp(-x) = x",
    "x^2 = exp(x)",
    "sqrt(x) = 3",
  ])("%s", (eq) => {
    const r = solveEquation(eq)!;
    expect(r).not.toBeNull();
    const bad: string[] = [];
    for (const root of r.roots) {
      if (!Number.isFinite(root.re) || root.im !== 0) continue;
      const res = residual(eq, root.re);
      // Scaled by the root's own magnitude: at x = 997 a residual of 1e-9 is a far
      // tighter statement than at x = 0.5, and an absolute bound would either be
      // vacuous at the top of the range or impossible at the bottom.
      const scale = Math.max(1, Math.abs(root.re));
      if (!(res < 1e-6 * scale)) bad.push(`${root.display} -> |f| = ${res.toExponential(3)}`);
    }
    expect(bad).toEqual([]);
  });

  test("a pole is never reported as a root", () => {
    // Each of these used to return the pole as an exact-looking root, with a
    // residual between 1e12 and 1e36.
    for (const eq of [
      "1/(x-2.25) = 0",
      "x/(x-2.25) = 1",
      "(x+1)/(x-2.25) = 1",
      "1/(x-2.25)^3 = 0",
      "1/(x-0.5) = 0",
      "1/(x+3.7) = 0",
    ]) {
      const r = solveEquation(eq)!;
      const near = r.roots.filter((k) => residual(eq, k.re) > 1);
      expect({ eq, spurious: near.map((k) => k.display) }).toEqual({ eq, spurious: [] });
    }
  });

  test("moving the pole off the sampling grid does not resurrect it", () => {
    // The old code got 1/(x-2) = 0 right ONLY because the grid lands exactly on 2.
    // If that is still what is doing the work, an off-grid pole will show up.
    for (const c of [2, 2.25, 0.5, 0.3333333, 1.7320508, -4.1234, 123.456]) {
      const eq = `1/(x-${c}) = 0`;
      const r = solveEquation(eq)!;
      expect({ c, n: r.roots.length }).toEqual({ c, n: 0 });
    }
  });
});

describe("completeness: tightening the test must not lose real answers", () => {
  test("every analytically known solution is still found", () => {
    // Values from closed form, not from this code.
    const cases: Array<[string, number[]]> = [
      ["exp(x) = 2", [Math.LN2]],
      ["ln(x) = 1", [Math.E]],
      ["sqrt(x) = 3", [9]],
      ["cos(x) = 1", [0]],
      ["sin(x) = 0", [0, Math.PI, -Math.PI, 2 * Math.PI]],
      ["tan(x) = 2", [Math.atan(2), Math.atan(2) + Math.PI, Math.atan(2) - Math.PI]],
      ["sin(x) = 0.5", [Math.asin(0.5), Math.PI - Math.asin(0.5)]],
      ["x*exp(x) = 1", [0.5671432904097838]],            // the Omega constant
      ["cos(x) = x", [0.7390851332151607]],              // the Dottie number
      ["exp(-x) = x", [0.5671432904097838]],
    ];
    for (const [eq, expected] of cases) {
      const r = solveEquation(eq)!;
      for (const want of expected) {
        const found = r.roots.some((k) => Math.abs(k.re - want) < 1e-6 * Math.max(1, Math.abs(want)));
        expect({ eq, want, found }).toEqual({ eq, want, found: true });
      }
    }
  });

  test("the count of real solutions to tan(x) = 2 is unchanged by the fix", () => {
    // Before the fix this returned 1176 candidates: 588 real solutions and 588
    // asymptotes, alternating. Removing the asymptotes must leave the 588 real
    // ones, not 587. (588 rather than the analytic ~637 in this range is a
    // pre-existing limit of a 0.5-spaced scan against a period of pi — the caveat
    // on the result says so, and this fix neither improved nor worsened it.)
    const r = solveEquation("tan(x) = 2")!;
    expect(r.roots.length).toBe(588);
    // and every one of them is genuinely a solution
    for (const k of r.roots) {
      expect(residual("tan(x) = 2", k.re)).toBeLessThan(1e-6 * Math.max(1, Math.abs(k.re)));
    }
  });

  test("a steep but finite crossing is still accepted", () => {
    // The residual test must not mistake steepness for a pole. These have large
    // derivatives at the root and would be the first casualties of an absolute
    // |f| < 1e-13 requirement.
    for (const [eq, want] of [
      ["1000000*x - 1 = 0", 1e-6],
      ["exp(10*x) = 1", 0],
      ["x^9 = 0.001", Math.pow(0.001, 1 / 9)],
    ] as [string, number][]) {
      const r = solveEquation(eq)!;
      const found = r.roots.some((k) => Math.abs(k.re - want) < 1e-6 * Math.max(1, Math.abs(want)));
      expect({ eq, found }).toEqual({ eq, found: true });
    }
  });
});

describe("the tolerance bands where roots went missing", () => {
  // Both were ABSOLUTE thresholds on quantities whose size is set by the
  // coefficients, so each created a band: inputs on either side worked, and a test
  // sampling either side certified the bug.
  test.each([
    ["0.0000000001*x^2 - 0.0001 = 0", [1000, -1000]],
    ["0.0000001*x^2 - 0.0000001 = 0", [1, -1]],
    ["0.0000000000001*x^2 - 1 = 0", [3162277.6601683795, -3162277.6601683795]],
    ["1e-20*x^2 - 1 = 0", [1e10, -1e10]],
    ["x^2 - 1e-20 = 0", [1e-10, -1e-10]],
  ] as [string, number[]][])("%s", (eq, expected) => {
    const r = solveEquation(eq)!;
    expect(r.roots.length).toBe(expected.length);
    for (const want of expected) {
      const found = r.roots.some((k) => Math.abs(k.re - want) <= 1e-9 * Math.max(1, Math.abs(want)));
      expect({ eq, want, found }).toEqual({ eq, want, found: true });
    }
  });

  test("a linear equation with a huge constant term still solves", () => {
    // My FIRST attempt at making trimPoly relative broke this: scaling by the
    // largest coefficient meant the x coefficient of 1 was compared against 1e285
    // and deleted, so an equation with the root 1e300 came back "no solution".
    // A large constant term does not make the x term negligible.
    for (const [eq, want] of [
      ["x - 1e300 = 0", 1e300],
      ["x - 1e15 = 0", 1e15],
      ["x - 1e30 = 0", 1e30],
      ["1e300*x - 1 = 0", 1e-300],
    ] as [string, number][]) {
      const r = solveEquation(eq)!;
      expect({ eq, n: r.roots.length }).toEqual({ eq, n: 1 });
      expect(r.roots[0].re).toBe(want);
      // and no spurious warning on an ordinary equation
      expect({ eq, caveats: r.caveats.length }).toEqual({ eq, caveats: 0 });
    }
  });

  test("only EXACT zeros are trimmed, so cancellation still reduces the degree", () => {
    // The trim exists for this. Subtracting equal doubles gives exactly 0.
    const r = solveEquation("x^2 + x = x^2 + 1")!;
    expect(r.method).toBe("exact (linear)");
    expect(r.roots[0].re).toBe(1);
  });
});

describe("an identity is an identity, not four thousand roots", () => {
  test.each(["(x-1)/(x-1) = 1", "x/x = 1", "sin(x)/sin(x) = 1"])("%s", (eq) => {
    const r = solveEquation(eq)!;
    expect(r.method).toBe("identity");
    expect(r.roots).toEqual([]);
    expect(r.caveats.join(" ")).toMatch(/identity/i);
  });

  test("it is fast, where enumerating the grid took about 2.9 seconds", () => {
    const t0 = Date.now();
    solveEquation("(x-1)/(x-1) = 1");
    solveEquation("x/x = 1");
    expect(Date.now() - t0).toBeLessThan(500);
  });

  test("a function with zeros ON the grid is NOT mistaken for an identity", () => {
    // The identity probe samples at irrational offsets for exactly this reason.
    for (const eq of ["sin(x) = 0", "x = 0", "x^2 = 0", "x*(x-1) = 0"]) {
      const r = solveEquation(eq)!;
      expect({ eq, method: r.method }).not.toEqual({ eq, method: "identity" });
    }
  });
});
