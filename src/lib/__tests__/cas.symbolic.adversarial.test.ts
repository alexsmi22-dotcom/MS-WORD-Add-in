// v2.136.0 adversarial pass over the cas.ts symbolic batch: the boundary GCD,
// polyResultant, the symbolic-exponent split and exactRadicals.
//
// Aimed at what breaks GCDs and canonical equality in practice: large
// coefficients, coprime inputs, zero, three and four symbols, repeated factors,
// every cap edge (each refused BY NAME and inside a 4 s wall-clock bound — a
// clamp that bounds memory does not bound time), and 200+ seeded random
// identities checked against numeric evaluation in BOTH directions:
//   * exprEqual true  ⇒ numerically equal at random points;
//   * numerically unequal ⇒ exprEqual is never true.
// False negatives (true identity, exprEqual false) are allowed and COUNTED.

import { casSimplify, casSimplifyReport, exprEqual, polyResultant } from "../cas";
import { parseExpr, evalAst, format } from "../solve";

const P = parseExpr;
const S = (src: string): string => format(casSimplify(P(src)));

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

/** Value agreement at points where both sides are finite and well-conditioned. */
function agreeByValue(a: string, b: string, vars: string[], seed: number): boolean {
  const r = rng(seed);
  let compared = 0;
  for (let i = 0; i < 12 && compared < 4; i++) {
    const env: Record<string, number> = {};
    for (const v of vars) env[v] = 0.3 + 2.4 * r(); // positive: x^y stays real
    const va = evalAst(P(a), env), vb = evalAst(P(b), env);
    // Relative tolerance below, so large magnitudes are fine; only non-finite
    // points (a pole, 0/0) are skipped.
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    compared++;
    if (Math.abs(va - vb) > 1e-7 * Math.max(1, Math.abs(va))) return false;
  }
  return compared >= 2;
}

const timed = <T>(fn: () => T): { v: T; ms: number } => {
  const t0 = Date.now();
  const v = fn();
  return { v, ms: Date.now() - t0 };
};

describe("GCD edge inputs", () => {
  it("large coefficients cancel exactly", () => {
    const src = "(123456789*x + 987654321*y)*(x^2 + 3*y + 7)/((123456789*x + 987654321*y)*(x - y))";
    expect(S(src)).toBe("(x^2 + 3*y + 7)/(x - y)");
  });
  it("30-digit coefficients", () => {
    const k = "123456789012345678901234567890";
    const src = `(${k}*x - y)*(x + y)/((${k}*x - y)*(x - 2*y))`;
    const r = casSimplifyReport(P(src));
    expect(r.refused).toBeNull();
    expect(format(r.result)).toBe("(x + y)/(x - 2*y)");
  });
  it("coprime inputs: nothing cancelled, nothing refused, value unchanged", () => {
    for (const src of ["(x^2 + y^2 + 1)/(x*y - 1)", "(x + y)/(x - y)", "(x^3 - y^2)/(x^2 - y^3)"]) {
      const r = casSimplifyReport(P(src));
      expect(r.cancelled).toBeNull();
      expect(r.refused).toBeNull();
      expect(agreeByValue(format(r.result), src, ["x", "y"], 7)).toBe(true);
    }
  });
  it("a zero numerator is 0; a constant denominator never reaches the GCD", () => {
    expect(S("0/(x - y)")).toBe("0");
    expect(S("(x*y - x)/2")).toBe(S("x*y/2 - x/2"));
  });
  it("three symbols", () => {
    expect(S("((x + y + z)*(x - 2*z))/((x + y + z)*(y + z))")).toBe("(x - 2*z)/(y + z)");
  });
  it("four symbols, the cap edge, still reduces", () => {
    const src = "((a + b + c + d)*(a - d))/((a + b + c + d)*(b + c))";
    const r = casSimplifyReport(P(src));
    expect(r.refused).toBeNull();
    expect(format(r.result)).toBe("(a - d)/(b + c)");
  });
  it("repeated factors: (x-y)^3(x+y)/((x-y)^2(x^2+y^2)) keeps one (x - y)", () => {
    const src = "(x - y)^3*(x + y)/((x - y)^2*(x^2 + y^2))";
    const r = casSimplifyReport(P(src));
    expect(r.cancelled && format(r.cancelled)).toBe("x^2 - 2*x*y + y^2");
    expect(exprEqual(r.result, P("(x^2 - y^2)/(x^2 + y^2)"))).toBe(true);
  });
  it("a common factor free of the main symbol: (y+1)^2 x / ((y+1)(x+2))", () => {
    expect(S("(y + 1)^2*x/((y + 1)*(x + 2))")).toBe("(x*y + x)/(x + 2)");
  });
  it("degree exactly 12 is attempted; 13 is refused", () => {
    expect(casSimplifyReport(P("(x^12 - y^12)/(x - y)")).refused).toBeNull();
    expect(casSimplifyReport(P("(x^13 - y^13)/(x - y)")).refused).toMatch(/degree cap/);
  });
});

describe("caps refuse by name, inside 4 s", () => {
  it("five symbols", () => {
    const { v, ms } = timed(() => casSimplifyReport(P("(a + b)*(c + d + e)/((a + b)*(c - d))")));
    expect(v.refused).toMatch(/symbol cap/);
    expect(ms).toBeLessThan(4000);
  });
  it("more than 200 terms: (x + y + z + 1)^9 has 220", () => {
    const { v, ms } = timed(() => casSimplifyReport(P("(x + y + z + 1)^9/(x + y)")));
    expect(v.refused).toMatch(/term cap/);
    expect(ms).toBeLessThan(4000);
  });
  it("hard inputs inside every cap finish (answer or named refusal) inside 4 s", () => {
    const HARD = [
      "((x + y + z + w)^4 + 1)*((x - y + 2*z - w)^3 + 3)/(((x + y + z + w)^4 + 1)*((x*y - z*w)^2 + 1))",
      "((x + 2*y + 3*z)^6 - 1)/((x + 2*y + 3*z)^3 - 1)",
      "((x^12 + y^12 + 1)*(x^11 - y))/((x^12 + y^12 + 1)*(y^11 - x))",
      "(1234567891011*x^6 + 987654321987*y^6 + 1)^2/((1234567891011*x^6 + 987654321987*y^6 + 1)*(x - y))",
    ];
    for (const src of HARD) {
      const { v, ms } = timed(() => casSimplifyReport(P(src)));
      expect(ms).toBeLessThan(4000);
      if (v.refused === null && v.cancelled) {
        expect(agreeByValue(format(v.result), src, ["x", "y", "z", "w"], 11)).toBe(true);
      }
    }
  });
  it("polyResultant: Sylvester 12 works, 13 is null, both fast", () => {
    const ok = timed(() => polyResultant(P("x^6 + y*x + 1"), P("x^6 - y"), "x"));
    expect(ok.v).not.toBeNull();
    expect(ok.ms).toBeLessThan(4000);
    const no = timed(() => polyResultant(P("x^7 + y*x + 1"), P("x^6 - y"), "x"));
    expect(no.v).toBeNull();
    expect(no.ms).toBeLessThan(100);
  });
});

describe("polyResultant against an independent route", () => {
  it("Res_x(p, q) vanishes exactly at the y where p and q share a root (numeric scan)", () => {
    // p = x^2 + y*x + 1, q = x - y: shared root x = y ⇒ 2y^2 + 1 = 0 — no real y, and
    // Res = q-substitution p(y) = 2y^2 + 1 (deg q = 1, lead 1).
    const r = polyResultant(P("x^2 + y*x + 1"), P("x - y"), "x")!;
    expect(exprEqual(r, P("2*y^2 + 1"))).toBe(true);
  });
  it("matches the product formula Res = lc(a)^n Π b(αᵢ) for random rational quadratics", () => {
    const r = rng(9);
    for (let i = 0; i < 25; i++) {
      const c = () => Math.floor(r() * 9) - 4;
      const a2 = c() || 1, a1 = c(), a0 = c(), b2 = c() || 2, b1 = c(), b0 = c();
      const A = `${a2}*x^2 + ${a1}*x + ${a0}`, B = `${b2}*x^2 + ${b1}*x + ${b0}`;
      const res = polyResultant(P(A), P(B), "x")!;
      const val = evalAst(res, {});
      // Sylvester 4x4 determinant computed directly in floats.
      const M = [
        [a2, a1, a0, 0], [0, a2, a1, a0],
        [b2, b1, b0, 0], [0, b2, b1, b0],
      ];
      const det = (m: number[][]): number =>
        m.length === 1 ? m[0][0]
          : m[0].reduce((s, v, j) => s + (j % 2 ? -1 : 1) * v * det(m.slice(1).map((row) => row.filter((_, k) => k !== j))), 0);
      expect(val).toBeCloseTo(det(M), 9);
    }
  });
});

describe("200 random algebraic identities vs numeric evaluation", () => {
  const r = rng(20261014);
  const leaf = (): string => ["x", "y", "2", "3", "x", "y", "1/2", "z"][Math.floor(r() * 8)];
  function rexpr(depth: number): string {
    if (depth <= 0) return leaf();
    const a = rexpr(depth - 1), b = rexpr(depth - 1), p = r();
    if (p < 0.3) return `(${a} + ${b})`;
    if (p < 0.5) return `(${a} - ${b})`;
    if (p < 0.8) return `(${a} * ${b})`;
    if (p < 0.9) return `(${a})^2`;
    return `sin(${a})`;
  }
  /** Identity templates over random sub-expressions A, B, C. */
  const TEMPLATES: ((A: string, B: string, C: string) => [string, string])[] = [
    (A, B) => [`((${A})*(${B}))/(${B})`, `${A}`],
    (A, B) => [`((${A})^2 - (${B})^2)/((${A}) - (${B}))`, `(${A}) + (${B})`],
    (A, B, C) => [`((${A})*(${C}) + (${B})*(${C}))/((${A}) + (${B}))`, `${C}`],
    (A, B) => [`((${A})^3 - (${B})^3)/((${A}) - (${B}))`, `(${A})^2 + (${A})*(${B}) + (${B})^2`],
    (A) => [`x^((${A}) + 2)`, `x^2*x^(${A})`],
    (A) => [`x^(y - 1)*(${A})`, `(${A})*x^y/x`],
    (A, B) => [`2^((${A}) + 1)*(${B})`, `2*(${B})*2^(${A})`],
  ];
  const VARS = ["x", "y", "z"];

  it("equal ⇒ numerically equal; perturbed (numerically unequal) ⇒ never equal", () => {
    let trueCount = 0, falseNeg = 0, nullCount = 0, checkedUnequal = 0;
    for (let i = 0; i < 210; i++) {
      const A = rexpr(2), B = rexpr(1), C = rexpr(1);
      const [lhs, rhs] = TEMPLATES[i % TEMPLATES.length](A, B, C);
      // Skip degenerate draws where a divisor is identically 0 (B - B, …).
      const eq = exprEqual(P(lhs), P(rhs));
      if (eq === null) { nullCount++; continue; }
      if (eq) {
        trueCount++;
        // Direction 1: a claimed identity must hold numerically.
        if (!agreeByValue(lhs, rhs, VARS, i)) {
          // Ill-conditioned draws (0/0 everywhere) are not counter-examples; but a
          // finite disagreement IS one.
          expect(`identity ${lhs} = ${rhs}`).toBe("numerically equal");
        }
      } else {
        falseNeg++;
      }
      // Direction 2: a perturbed right side is numerically different, so it must
      // NEVER compare equal.
      const perturbed = i % 2 ? `(${rhs}) + 1/7` : `(${rhs})*(1 + x/1000)`;
      if (!agreeByValue(lhs, perturbed, VARS, i + 1)) {
        checkedUnequal++;
        expect(`${lhs} vs ${perturbed}: ${exprEqual(P(lhs), P(perturbed))}`).not.toMatch(/: true$/);
      }
    }
    // The battery must actually exercise both directions.
    expect(trueCount).toBeGreaterThan(150);
    expect(checkedUnequal).toBeGreaterThan(150);
    // False negatives are allowed, but should be rare for these templates.
    expect(falseNeg).toBeLessThan(10);
    expect(nullCount).toBeLessThan(30);
  });

  it("casSimplify (with the boundary GCD) never changes a value on 200 random rational functions", () => {
    const r2 = rng(424242);
    const lin = (): string => {
      const c = () => Math.floor(r2() * 7) - 3;
      return `(${c()}*x + ${c() || 1}*y + ${c()}*z + ${c()})`;
    };
    let reduced = 0;
    for (let i = 0; i < 200; i++) {
      const common = lin(), n1 = lin(), d1 = lin();
      const src = `(${common}*${n1}${i % 3 ? `*${lin()}` : ""})/(${common}*${d1})`;
      let rep;
      try { rep = casSimplifyReport(P(src)); } catch { continue; }
      if (rep.cancelled) reduced++;
      const out = format(rep.result);
      if (!agreeByValue(out, src, VARS, 1000 + i)) {
        expect(`${src} → ${out}`).toBe("same value");
      }
    }
    expect(reduced).toBeGreaterThan(120);
  });
});

describe("exactRadicals soundness under random radical expressions", () => {
  it("exact-mode zero ⇔ numeric zero on 120 random radical sums", () => {
    const r = rng(77);
    const atoms = ["sqrt(2)", "sqrt(3)", "sqrt(6)", "cbrt(2)", "cbrt(4)", "1", "2^(1/4)", "1/2"];
    const pick = () => atoms[Math.floor(r() * atoms.length)];
    let zeros = 0, nonzeros = 0;
    for (let i = 0; i < 120; i++) {
      const a = `(${pick()} + ${pick()})`, b = `(${pick()} - ${pick()})`, c = `(${pick()} + 2*${pick()})`;
      // Even i: a TRUE identity written two ways (expanded vs factored), so the
      // difference is exactly 0. Odd i: the same with one radical perturbed.
      const lhs = `${a}^2*${b} + ${a}*${c}`;
      const rhs = i % 2 === 0 ? `${a}*(${a}*${b} + ${c})` : `${a}*(${a}*${b} + ${c}) + ${pick()}*${pick()}/9`;
      const expr = `${lhs} - (${rhs})`;
      const v = evalAst(P(expr), {});
      const eq = exprEqual(P(expr), P("0"), { exactRadicals: true });
      if (eq === true) {
        zeros++;
        // Soundness: an exact zero is a numeric zero.
        expect(Math.abs(v)).toBeLessThan(1e-9);
      } else {
        // Completeness for radicals of rationals: a numeric zero is an exact zero.
        expect(Math.abs(v)).toBeGreaterThan(1e-9);
        nonzeros++;
      }
    }
    expect(zeros).toBe(60);
    expect(nonzeros).toBe(60);
  });
});
