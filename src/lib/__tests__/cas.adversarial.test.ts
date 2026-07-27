// Adversarial bug test — the CAS core (cas.ts) and its callers.
//
// Written in the second adversarial sweep (2026-07-27), applying the lens that
// found the Smith Normal Form divergence: WHERE IS THIS UNSOUND OUTSIDE THE
// REGIME THE EXISTING TESTS OCCUPY? Two structures had that smell — Euclidean
// GCD over the rationals (the classic coefficient-explosion algorithm) and the
// atom-key scheme (if the key function is not injective, distinct atoms merge
// and equality silently returns WRONG answers). Both survived; the defect was
// somewhere else entirely:
//
//   canonicalisation can WIDEN A DOMAIN. sqrt(x)^2 normalises to x, which is
//   finite at x = −4 where the original is NaN. ∫sqrt(x)² over [−1,1] therefore
//   came back as "0, exact (symbolic)" with no caveat, for an integral that
//   does not exist. Fixed by scanning the ORIGINAL integrand; pinned below.
//
// The most valuable assertions here are the SOUNDNESS ones: a false positive in
// exprEqual, or an antiderivative that fails at a random point, is wrong
// mathematics rather than a missing feature.

import { exprEqual, canonicalKey } from "../cas";
import { parseExpr, evalAst, format, simplify, integrate, differentiate, derivative, solveEquation, Expr } from "../solve";
import { symbolicIntegrate } from "../casint";

const P = (s: string) => parseExpr(s);

describe("domain widening must not produce a confident wrong answer", () => {
  it("an integral whose integrand is undefined inside the range is CAVEATED", () => {
    const r = integrate("sqrt(x)^2", -1, 1)!;
    expect(r).not.toBeNull();
    // The value is the formal one; what matters is that it no longer arrives bare.
    expect(r.caveats.some((c) => /UNDEFINED/i.test(c))).toBe(true);
  });
  it("the same hazard through a product spelling", () => {
    const r = integrate("sqrt(x)*sqrt(x)", -1, 1)!;
    expect(r.caveats.some((c) => /UNDEFINED/i.test(c))).toBe(true);
  });
  it("a legitimate range over the same integrand stays clean", () => {
    const r = integrate("sqrt(x)^2", 0, 2)!;
    expect(r.value).toBeCloseTo(2, 9);
    expect(r.caveats.some((c) => /UNDEFINED/i.test(c))).toBe(false);
  });
  it("ln of a non-positive argument inside the range is caught", () => {
    const r = integrate("ln(x)", -1, 2);
    if (r && r.method === "exact (symbolic)") {
      expect(r.caveats.length).toBeGreaterThan(0);
    }
  });
  it("ordinary integrals gain no spurious warning", () => {
    for (const [src, a, b] of [["x^2", 0, 3], ["sin(x)", 0, Math.PI], ["exp(x)", 0, 1]] as [string, number, number][]) {
      const r = integrate(src, a, b)!;
      expect(r.caveats.some((c) => /UNDEFINED/i.test(c))).toBe(false);
    }
  });
});

describe("numeric quadrature must not hang on an undefined integrand", () => {
  // THE WORST BUG THIS SWEEP FOUND. adaptiveSimpson's convergence test is
  // |left + right - whole| < 15*tol, and ANY comparison against NaN is false —
  // so one non-finite sample defeated the short-circuit and drove the full
  // binary recursion to depth 50, about 2^51 evaluations. integrate("ln(x)",
  // -1, 2) reached it via the symbolic path returning NaN at an endpoint and
  // falling through. In the pane that is an unrecoverable freeze: a synchronous
  // loop cannot be interrupted, and even the test runner's own timeout could
  // not stop it. These bounds are deliberately tight.
  const HAZARDS: [string, number, number][] = [
    ["ln(x)", -1, 2],
    ["sqrt(x)", -1, 1],
    ["ln(x)", -5, 5],
    ["sqrt(x-3)", 0, 10],
    ["1/(x-0.5)", 0, 1],
    ["ln(x)*sqrt(x)", -2, 2],
  ];
  for (const [src, a, b] of HAZARDS) {
    it(`integral of ${src} over [${a},${b}] returns promptly instead of hanging`, () => {
      const t0 = Date.now();
      const r = integrate(src, a, b);
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r).not.toBeNull();
    });
  }
  it("an undefined integrand reports NO value rather than a NaN dressed as one", () => {
    const r = integrate("ln(x)", -1, 2)!;
    expect(Number.isFinite(r.value)).toBe(false);
    expect(r.method).toBe("undefined on this interval");
    expect(r.caveats.some((c) => /undefined/i.test(c))).toBe(true);
  });
  it("valid intervals over the same integrands are unaffected", () => {
    expect(integrate("ln(x)", 1, 2)!.value).toBeCloseTo(2 * Math.log(2) - 1, 9);
    expect(integrate("sqrt(x)", 0, 4)!.value).toBeCloseTo(16 / 3, 9);
  });
});

describe("canonical equality soundness — a false positive is wrong mathematics", () => {
  const BASES = [
    "x", "x^2 + 1", "sin(x)", "x/(x+1)", "exp(x)*x", "sqrt(x)+1",
    "(x+y)^2", "1/(x^2+1)", "ln(x)*x", "x^3 - 2*x",
  ];
  it("algebraically identical spellings compare equal", () => {
    for (const b of BASES) {
      for (const s of [`(${b})`, `(${b}) + 0`, `(${b}) * 1`, `((${b}) * 2)/2`, `0 + (${b})`, `-(-(${b}))`]) {
        expect(`${b} == ${s}: ${exprEqual(P(b), P(s))}`).toBe(`${b} == ${s}: true`);
      }
    }
  });
  it("genuinely different expressions are NEVER claimed equal", () => {
    for (const b of BASES) {
      for (const s of [`(${b}) + 1`, `(${b}) * 2`, `(${b}) - 1`, `(${b})^2 + 1`]) {
        expect(`${b} vs ${s}: ${exprEqual(P(b), P(s))}`).not.toBe(`${b} vs ${s}: true`);
      }
    }
  });
  it("distinct opaque atoms never share a canonical key", () => {
    const PAIRS: [string, string][] = [
      ["sin(x)", "sin(y)"], ["sin(x)", "cos(x)"], ["exp(x)", "exp(2*x)"],
      ["x^y", "y^x"], ["x^0.5", "x^1.5"], ["sin(x + 1)", "sin(x) + 1"],
      ["2^x", "3^x"], ["ln(x*y)", "ln(x)*y"], ["sqrt(x+1)", "sqrt(x)+1"],
      ["atan(x/2)", "atan(x)/2"],
    ];
    for (const [a, b] of PAIRS) {
      const ka = canonicalKey(P(a)), kb = canonicalKey(P(b));
      expect(`${a} / ${b}: ${ka === kb ? "COLLISION" : "distinct"}`).toBe(`${a} / ${b}: distinct`);
    }
  });
});

describe("no coefficient explosion — the Smith Normal Form failure class", () => {
  const CASES = [
    "(x^10 - 1)/(x - 1)",
    "(x^15 - 1)/(x^3 - 1)",
    "(x^20 + x^10 + 1)/(x^2 + x + 1)",
    "((x+1)^12)/((x+1)^6)",
    "(x/3 + 1/7)^8",
    "(x/3 + y/7 + 1/11)^5",
    "(0.1*x + 0.3)^10",
    "1/3 + 1/5 + 1/7 + 1/11 + 1/13 + 1/17 + 1/19 + 1/23",
    "(1/999983)*x + (1/999979)*x",
  ];
  for (const src of CASES) {
    it(`${src} stays small and fast`, () => {
      const t0 = Date.now();
      const out = format(simplify(P(src)));
      expect(Date.now() - t0).toBeLessThan(3000);
      // Runaway integers are the signature of the failure this guards against.
      const longest = Math.max(0, ...(out.match(/\d+/g) || []).map((s) => s.length));
      expect(`${src} longestInt=${longest}`).toBe(`${src} longestInt=${longest > 25 ? "RUNAWAY" : longest}`);
    });
  }
});

describe("structural robustness", () => {
  it("deep nesting does not overflow the stack", () => {
    for (const depth of [50, 200, 800]) {
      let s = "x";
      for (let i = 0; i < depth; i++) s = `(${s} + 1)`;
      expect(() => simplify(P(s))).not.toThrow();
    }
  });
  it("simplify preserves values at depth 5", () => {
    let seed = 555777;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const leaves = ["x", "y", "2", "3", "1/3", "0.25"];
    const fns = ["sin", "cos", "exp", "sqrt", "ln", "tan", "atan"];
    const gen = (d: number): string => {
      if (d <= 0) return leaves[Math.floor(rnd() * leaves.length)];
      const p = rnd(); const a = gen(d - 1), b = gen(d - 1);
      if (p < 0.2) return `(${a} + ${b})`;
      if (p < 0.4) return `(${a} - ${b})`;
      if (p < 0.6) return `(${a} * ${b})`;
      if (p < 0.72) return `(${a} / ${b})`;
      if (p < 0.84) return `(${a})^${1 + Math.floor(rnd() * 3)}`;
      return `${fns[Math.floor(rnd() * fns.length)]}(${a})`;
    };
    let compared = 0;
    for (let i = 0; i < 150; i++) {
      let e: Expr;
      try { e = P(gen(5)); } catch { continue; }
      const s = simplify(e);
      for (const pt of [{ x: 0.83, y: 1.27 }, { x: 2.11, y: 0.61 }]) {
        let want: number, got: number;
        try { want = evalAst(e, pt); got = evalAst(s, pt); } catch { continue; }
        if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
        compared++;
        expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-8 * (1 + Math.abs(want)));
      }
    }
    expect(compared).toBeGreaterThan(150);
  });
});

describe("integration and rearrangement verified at RANDOM points, not fixed samples", () => {
  it("every antiderivative the engine returns survives random-point checking", () => {
    const SRCS = [
      "x^3", "1/x", "exp(2*x)", "sin(3*x)", "x*exp(x)", "ln(x)", "tan(x)",
      "1/(x^2+1)", "x/(x^2+4)", "1/(x*(x+2))", "x^2*ln(x)", "atan(x)",
      "sqrt(x)", "x*cos(x)", "exp(x)*x^2", "(x+1)/(x^2+2*x+2)", "1/(x-1)^2",
      "x/sqrt(x^2+1)", "sin(x)*cos(x)", "1/(x^2-4)", "x^3/(x^2+1)", "exp(sin(x))*cos(x)",
    ];
    let seed = 24680;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let checked = 0;
    for (const src of SRCS) {
      const r = symbolicIntegrate(P(src), "x", derivative);
      if (!r) continue;
      const dF = P(differentiate(format(r.F))!.derivative);
      const f = P(src);
      for (let k = 0; k < 40; k++) {
        const x = 0.05 + rnd() * 4.5;
        let want: number, got: number;
        try { want = evalAst(f, { x }); got = evalAst(dF, { x }); } catch { continue; }
        if (!Number.isFinite(want) || !Number.isFinite(got)) continue;
        checked++;
        expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-5 * (1 + Math.abs(want)));
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("every rearrangement root satisfies its equation at random parameter values", () => {
    const EQS: [string, string, string[]][] = [
      ["F = m*a", "a", ["F", "m"]],
      ["P*V = n*R*T", "T", ["P", "V", "n", "R"]],
      ["C = 5/9*(F - 32)", "F", ["C"]],
      ["v^2 = u^2 + 2*a*s", "s", ["v", "u", "a"]],
      ["y = (a + b)*x", "x", ["y", "a", "b"]],
      ["a*x^2 + b*x + c = 0", "x", ["a", "b", "c"]],
      ["s = u*t + a*t^2/2", "t", ["s", "u", "a"]],
    ];
    let seed = 13579;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let checked = 0;
    for (const [eq, target, others] of EQS) {
      const r = solveEquation(eq, target);
      expect(`${eq} for ${target}: ${r && r.roots.length ? "solved" : "NO ROOTS"}`).toBe(`${eq} for ${target}: solved`);
      const [lhsS, rhsS] = eq.split("=");
      const lhs = P(lhsS), rhs = P(rhsS);
      for (let k = 0; k < 30; k++) {
        const env: Record<string, number> = {};
        for (const v of others) env[v] = 0.3 + rnd() * 4;
        for (const root of r!.roots) {
          let rv: number, resid: number;
          try {
            rv = evalAst(P(root.display), env);
            if (!Number.isFinite(rv)) continue;
            resid = evalAst(lhs, { ...env, [target]: rv }) - evalAst(rhs, { ...env, [target]: rv });
          } catch { continue; }
          if (!Number.isFinite(resid)) continue;
          checked++;
          expect(Math.abs(resid)).toBeLessThanOrEqual(1e-6 * (1 + Math.abs(rv)));
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe("integration does not hang on hostile input", () => {
  const HOSTILE = [
    "x*exp(x)*sin(x)*cos(x)*ln(x)",
    "1/(x^7+x^5+x^3+x+1)",
    "sin(sin(sin(x)))",
    "((x+1)*(x+2)*(x+3)*(x+4))/((x+5)*(x+6))",
    "exp(exp(x))",
    "x^10*exp(x)",
    "1/((x^2+1)*(x^2+2)*(x^2+3))",
  ];
  for (const src of HOSTILE) {
    it(`${src.slice(0, 38)} resolves or refuses quickly`, () => {
      const t0 = Date.now();
      expect(() => symbolicIntegrate(P(src), "x", derivative)).not.toThrow();
      expect(Date.now() - t0).toBeLessThan(5000);
    });
  }
});
