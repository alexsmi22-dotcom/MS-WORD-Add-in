// CAS core (cas.ts) — canonical forms, equality, symbolic rearrangement.
//
// Built to FALSIFY, in the house style:
//   * canonical simplification must never change a value — random expressions
//     are evaluated before and after at sample points (property-style, seeded
//     deterministic PRNG, no flakiness);
//   * equal expressions must get identical canonical forms; unequal ones must
//     not (both directions probed);
//   * every symbolic rearrangement is verified by SUBSTITUTING THE ANSWER BACK
//     and requiring canonical 0 (linear) or ≈0 at samples (quadratic, where the
//     sqrt atom blocks the exact route);
//   * the design-table inputs from docs/CAS-DESIGN.md §1 — the measured ceiling
//     this work exists to raise — are pinned one by one.

import { casSimplify, canonicalKey, exprEqual, substituteVar, solveRationalInVar } from "../cas";
import { parseExpr, evalAst, format, simplify, solveEquation, differentiate } from "../solve";

const S = (src: string): string => format(simplify(parseExpr(src)));

// ---------------------------------------------------------------------------
// The design table: what solve could not do on 2026-07-26, now pinned.
// ---------------------------------------------------------------------------
describe("the CAS-DESIGN §1 ceiling table", () => {
  it("2*x + 3*x collects to 5*x", () => {
    expect(S("2*x + 3*x")).toBe("5*x");
  });
  it("x + x collects to 2*x", () => {
    expect(S("x + x")).toBe("2*x");
  });
  it("x/x cancels to 1", () => {
    expect(S("x/x")).toBe("1");
  });
  it("(x+1)*(x+1) expands to x^2 + 2*x + 1", () => {
    expect(S("(x+1)*(x+1)")).toBe("x^2 + 2*x + 1");
  });
  it("F = m*a solved for a gives F/m, with m ≠ 0 stated", () => {
    const r = solveEquation("F = m*a", "a")!;
    expect(r.method).toBe("exact (symbolic rearrangement)");
    expect(r.roots.length).toBe(1);
    expect(r.roots[0].display).toBe("F/m");
    expect(r.roots[0].exact).toBe(true);
    expect(r.caveats.some((c) => c.includes("m ≠ 0"))).toBe(true);
  });
  it("d/dx sin(x)cos(x) reads cos(x)^2 - sin(x)^2", () => {
    expect(differentiate("sin(x)*cos(x)")!.derivative).toBe("cos(x)^2 - sin(x)^2");
  });
  it("2x + y = 5 names its unknowns so a caller can offer the choice", () => {
    const r = solveEquation("2x + y = 5")!;
    expect(r.method).toBe("unsolved");
    expect(r.unknowns).toEqual(expect.arrayContaining(["x", "y"]));
    const forY = solveEquation("2x + y = 5", "y")!;
    expect(forY.roots.length).toBe(1);
    // y = 5 − 2x: check by value rather than pinning one spelling.
    const y = parseExpr(forY.roots[0].display);
    for (const x of [0, 1.5, -2]) expect(evalAst(y, { x })).toBeCloseTo(5 - 2 * x, 10);
  });
});

// ---------------------------------------------------------------------------
// Canonical equality — both directions.
// ---------------------------------------------------------------------------
describe("canonical equality", () => {
  const EQUAL: [string, string][] = [
    ["(x+1)^2", "x^2 + 2*x + 1"],
    ["1/3 + 1/3 + 1/3", "1"], // exact rationals, not floats
    ["sin(x+0)", "sin(x)"], // atoms keyed by canonical form of their argument
    ["(x^2-1)/(x-1)", "x + 1"], // univariate GCD cancellation
    ["x*y + y*x", "2*x*y"],
    ["(x+y)^2 - (x-y)^2", "4*x*y"],
    ["x^3/x", "x^2"],
    ["sin(x)^2*cos(x)", "cos(x)*sin(x)*sin(x)"],
    ["2^x*2^x", "(2^x)^2"],
    ["1/(1/x)", "x"],
  ];
  for (const [a, b] of EQUAL) {
    it(`${a} ≡ ${b}`, () => {
      expect(exprEqual(parseExpr(a), parseExpr(b))).toBe(true);
      expect(canonicalKey(parseExpr(a))).toBe(canonicalKey(parseExpr(b)));
    });
  }
  const UNEQUAL: [string, string][] = [
    ["x + 1", "x + 2"],
    ["x^2", "x^3"],
    ["sin(x)", "cos(x)"],
    ["x/3", "0.3333*x"], // 0.3333 is NOT 1/3 — exactness must not blur this
    ["(x+1)^2", "x^2 + 1"],
  ];
  for (const [a, b] of UNEQUAL) {
    it(`${a} ≢ ${b}`, () => {
      expect(exprEqual(parseExpr(a), parseExpr(b))).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Property: simplification never changes the value. Deterministic seeded PRNG.
// ---------------------------------------------------------------------------
describe("canonical simplification preserves values (random expressions)", () => {
  // mulberry32 — tiny, deterministic, good enough for structural fuzzing.
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomExpr(r: () => number, depth: number): string {
    if (depth <= 0) {
      const leaves = ["x", "x", "y", "2", "3", "0.5", "1"];
      return leaves[Math.floor(r() * leaves.length)];
    }
    const pick = r();
    const a = randomExpr(r, depth - 1);
    const b = randomExpr(r, depth - 1);
    if (pick < 0.2) return `(${a} + ${b})`;
    if (pick < 0.4) return `(${a} - ${b})`;
    if (pick < 0.6) return `(${a} * ${b})`;
    if (pick < 0.72) return `(${a} / ${b})`;
    if (pick < 0.82) return `(${a})^${1 + Math.floor(r() * 3)}`;
    const fns = ["sin", "cos", "exp", "sqrt", "ln"];
    return `${fns[Math.floor(r() * fns.length)]}(${a})`;
  }

  it("agrees with the original at sample points across 80 seeded expressions", () => {
    const r = rng(20260726);
    const POINTS = [
      { x: 0.7, y: 1.3 },
      { x: 1.9, y: 0.4 },
      { x: 2.6, y: 2.2 },
    ];
    let compared = 0;
    for (let i = 0; i < 80; i++) {
      const src = randomExpr(r, 3);
      let e;
      try {
        e = parseExpr(src);
      } catch {
        continue;
      }
      const s = simplify(e); // CAS path, peephole fallback — must never throw
      for (const pt of POINTS) {
        let want: number, got: number;
        try {
          want = evalAst(e, pt);
          got = evalAst(s, pt);
        } catch {
          continue;
        }
        if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
        // Relative tolerance: rebuilt constants round-trip doubles, so only
        // float noise from re-association should remain.
        expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * (1 + Math.abs(want)));
        compared++;
      }
    }
    // The sweep must actually have tested something.
    expect(compared).toBeGreaterThan(100);
  });

  it("is idempotent: simplify(simplify(e)) = simplify(e) canonically", () => {
    const r = rng(42);
    for (let i = 0; i < 40; i++) {
      const src = randomExpr(r, 3);
      let e;
      try {
        e = parseExpr(src);
      } catch {
        continue;
      }
      const once = simplify(e);
      const twice = simplify(once);
      expect(format(twice)).toBe(format(once));
    }
  });
});

// ---------------------------------------------------------------------------
// Symbolic rearrangement — every answer substituted back.
// ---------------------------------------------------------------------------
describe("symbolic rearrangement of formulas", () => {
  /** Rearranges and proves the LINEAR answer by canonical back-substitution. */
  const rearranged = (eq: string, target: string): string => {
    const r = solveEquation(eq, target)!;
    expect(r).not.toBeNull();
    expect(r.method).toBe("exact (symbolic rearrangement)");
    expect(r.roots.length).toBeGreaterThan(0);
    const [lhs, rhs] = eq.split("=");
    const f = { t: "sub" as const, l: parseExpr(lhs), r: parseExpr(rhs) };
    for (const root of r.roots) {
      const back = substituteVar(f, target, parseExpr(root.display));
      expect(exprEqual(back, parseExpr("0"))).toBe(true);
    }
    return r.roots[0].display;
  };

  it("V = I*R for R", () => {
    const d = rearranged("V = I*R", "R");
    expect(d).toBe("V/I");
  });
  it("PV = nRT for T", () => {
    expect(rearranged("P*V = n*R*T", "T")).toBe("P*V/(n*R)");
  });
  it("C = 5/9*(F - 32) for F — exact rationals, no float dust", () => {
    const d = rearranged("C = 5/9*(F - 32)", "F");
    const F = parseExpr(d);
    expect(evalAst(F, { C: 100 })).toBeCloseTo(212, 10);
    expect(evalAst(F, { C: 0 })).toBeCloseTo(32, 10);
  });
  it("v^2 = u^2 + 2*a*s for s", () => {
    const d = rearranged("v^2 = u^2 + 2*a*s", "s");
    const s = parseExpr(d);
    expect(evalAst(s, { v: 10, u: 4, a: 2 })).toBeCloseTo((100 - 16) / 4, 10);
  });
  it("a rational equation: 1/x + 2 = 0 solves exactly with x ≠ 0 stated", () => {
    const r = solveEquation("1/x + 2 = 0", "x")!;
    expect(r.method).toBe("exact (symbolic rearrangement)");
    expect(evalAst(parseExpr(r.roots[0].display), {})).toBeCloseTo(-0.5, 12);
    expect(r.caveats.some((c) => c.includes("x ≠ 0"))).toBe(true);
  });

  it("quadratic in the target: s = u*t + a*t^2/2 for t, verified numerically", () => {
    const r = solveEquation("s = u*t + a*t^2/2", "t")!;
    expect(r.method).toBe("exact (symbolic rearrangement)");
    expect(r.roots.length).toBe(2);
    expect(r.caveats.some((c) => /±|quadratic/.test(c))).toBe(true);
    // u=3, a=2, s=20: t² + 3t − 20 = 0 → t = (−3 ± √89)/2.
    const env = { u: 3, a: 2, s: 20 };
    const got = r.roots.map((root) => evalAst(parseExpr(root.display), env)).sort((p, q) => p - q);
    const want = [(-3 - Math.sqrt(89)) / 2, (-3 + Math.sqrt(89)) / 2];
    expect(got[0]).toBeCloseTo(want[0], 9);
    expect(got[1]).toBeCloseTo(want[1], 9);
  });

  it("the general quadratic a*x^2 + b*x + c = 0 for x", () => {
    const r = solveEquation("a*x^2 + b*x + c = 0", "x")!;
    expect(r.method).toBe("exact (symbolic rearrangement)");
    expect(r.roots.length).toBe(2);
    expect(r.caveats.some((c) => c.includes("a ≠ 0"))).toBe(true);
    const env = { a: 1, b: 5, c: 6 };
    const got = r.roots.map((root) => evalAst(parseExpr(root.display), env)).sort((p, q) => p - q);
    expect(got[0]).toBeCloseTo(-3, 9);
    expect(got[1]).toBeCloseTo(-2, 9);
  });

  it("the ≠ 0 condition names the actual divisor, sign-normalised", () => {
    // The raw coefficient of x here is −a−b; the condition must not print as
    // "-a - b ≠ 0" when "a + b ≠ 0" is the same statement.
    const r = solveEquation("y = (a + b)*x", "x")!;
    expect(r.roots[0].display).toBe("y/(a + b)");
    expect(r.caveats.some((c) => c.includes("a + b ≠ 0"))).toBe(true);
  });

  it("every unknown of F = m*a round-trips numerically", () => {
    const CASES: [string, Record<string, number>, number][] = [
      ["a", { F: 6, m: 2 }, 3],
      ["m", { F: 6, a: 3 }, 2],
      ["F", { m: 2, a: 3 }, 6],
    ];
    for (const [v, env, want] of CASES) {
      const r = solveEquation("F = m*a", v)!;
      expect(r.roots.length).toBe(1);
      expect(evalAst(parseExpr(r.roots[0].display), env)).toBeCloseTo(want, 10);
    }
  });

  it("x inside a function blocks solving for x but not for the other symbol", () => {
    const rx = solveEquation("k = m*sin(x)", "x")!;
    expect(rx.roots.length).toBe(0); // honest refusal, not a guess
    const rm = solveEquation("k = m*sin(x)", "m")!;
    expect(rm.roots.length).toBe(1); // m = k/sin(x)
    expect(evalAst(parseExpr(rm.roots[0].display), { k: 2, x: 1 })).toBeCloseTo(2 / Math.sin(1), 9);
    expect(rm.caveats.some((c) => c.includes("sin(x) ≠ 0"))).toBe(true);
  });

  it("repeated calls are stable — no cross-call state leaks", () => {
    const a = solveEquation("F = m*a", "a")!.roots[0].display;
    solveEquation("x^2 - 4 = 0");
    differentiate("sin(x)*cos(x)");
    expect(solveEquation("F = m*a", "a")!.roots[0].display).toBe(a);
  });

  it("refuses what it cannot do instead of guessing: sin(m*x) = k for x", () => {
    const r = solveEquation("sin(m*x) = k", "x")!;
    expect(r.roots.length).toBe(0);
    expect(r.method).toBe("unsolved");
    expect(r.caveats.some((c) => /closed form|values/.test(c))).toBe(true);
  });

  it("solveRationalInVar itself reports the linear case verified exactly", () => {
    const f = parseExpr("F - m*a");
    const sol = solveRationalInVar(f, "a")!;
    expect(sol.kind).toBe("linear");
    expect(sol.verified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Derivative readability through the new simplifier.
// ---------------------------------------------------------------------------
describe("derivatives read conventionally", () => {
  it("no '+ -' artifacts across a batch of derivatives", () => {
    const SRCS = ["sin(x)*cos(x)", "x*exp(x)", "cos(x)^2", "x/(x^2+1)", "(x+1)*(x-1)", "sqrt(x^2+1)"];
    for (const src of SRCS) {
      const d = differentiate(src)!.derivative;
      expect(d).not.toMatch(/\+ -/);
      expect(d).not.toMatch(/- -/);
    }
  });
  it("d/dx x*exp(x) collects to x*exp(x) + exp(x)", () => {
    expect(differentiate("x*exp(x)")!.derivative).toBe("x*exp(x) + exp(x)");
  });
  it("d/dx sqrt(x^2+1) is the tidy x/sqrt(x^2 + 1)", () => {
    expect(differentiate("sqrt(x^2+1)")!.derivative).toBe("x/sqrt(x^2 + 1)");
  });
});

// ---------------------------------------------------------------------------
// Totality — nothing throws out of simplify().
// ---------------------------------------------------------------------------
describe("simplify stays total", () => {
  it("literal division by zero falls back instead of crashing", () => {
    expect(() => simplify(parseExpr("x/0"))).not.toThrow();
  });
  it("huge exponents stay opaque instead of exploding", () => {
    expect(() => simplify(parseExpr("(x+1)^500"))).not.toThrow();
  });
  it("casSimplify output for a plain polynomial is stable", () => {
    expect(format(casSimplify(parseExpr("(x+2)^3")))).toBe("x^3 + 6*x^2 + 12*x + 8");
  });
});
