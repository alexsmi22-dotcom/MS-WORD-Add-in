// Recurrence relations (recurrence.ts). Oracles: Fibonacci/Binet, the
// textbook linear examples, and the CLRS master-theorem cases.

import { tryRecurrence, Rat, parseRecurrence, solveCharacteristic } from "../recurrence";
import { DiscreteError } from "../discrete";

const run = (s: string) => tryRecurrence(s)!;
const closed = (s: string) => run(s).display[0];

describe("Rat", () => {
  it("normalises and parses", () => {
    expect(new Rat(6n, -4n).toString()).toBe("-3/2");
    expect(Rat.parse("0.25").toString()).toBe("1/4");
    expect(Rat.parse("-2.5").toString()).toBe("-5/2");
    expect(Rat.parse("3/6").toString()).toBe("1/2");
    expect(Rat.of(2).pow(10).toString()).toBe("1024");
  });
});

describe("parsing", () => {
  it("reads every common spelling of the sequence name", () => {
    for (const s of ["a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1", "a_n = a_{n-1} + a_{n-2}, a_0 = 0, a_1 = 1", "F[n] = F[n-1] + F[n-2]; F[0] = 0; F[1] = 1", "x_n = x_(n-1) + x_(n-2) with x_0 = 0 and x_1 = 1"]) {
      const p = parseRecurrence(s);
      expect(p && !("master" in p) ? p.coeffs.map(String) : null).toEqual(["1", "1"]);
    }
  });
  it("coefficients, forcing terms, implicit multiplication", () => {
    const p = parseRecurrence("a(n) = 3a(n-1) - 2a(n-2) + 2n + 1 + 3*2^n");
    expect(p && !("master" in p) ? p.coeffs.map(String) : null).toEqual(["3", "-2"]);
    expect(p && !("master" in p) ? p.forcing.map((f) => `${f.coef} n^${f.deg} ${f.base}^n`) : null).toEqual(["2 n^1 1^n", "1 n^0 1^n", "3 n^0 2^n"]);
  });
  it("refuses non-linear, variable-coefficient, high-order, and non-recurrences by name", () => {
    expect(() => run("a(n) = a(n-1)^2, a(0)=2")).toThrow(/non-linear/);
    expect(() => run("a(n) = a(n-1) * a(n-2), a(0)=1, a(1)=1")).toThrow(/non-linear/);
    expect(() => run("a(n) = n a(n-1), a(0)=1")).toThrow(/variable-coefficient/);
    expect(() => run("a(n) = a(n-5), a(0)=1")).toThrow(/order-4 cap/);
    expect(() => run("a(n) = 2n + 1")).toThrow(/not a recurrence/);
    expect(() => run("a(n) = a(n-1) + 1, a(0)=1, b=2")).toThrow(/not an initial condition/);
  });
  it("returns null for other engines' input", () => {
    for (const s of ["gcd 84 36", "10 choose 3", "(p -> q) & ~q", "A-B\nB-C", "dfa\nstates: q0", "x^2 - 5x + 6 = 0", "hello"]) expect(tryRecurrence(s)).toBeNull();
  });
});

describe("characteristic roots", () => {
  it("rational roots by the rational-root theorem, with multiplicity", () => {
    const r = solveCharacteristic([Rat.of(3), Rat.of(-2)]); // r² − 3r + 2 = (r−1)(r−2)
    expect(r.exactField).toBe(true);
    expect(r.roots.map((x) => x.exact!.toString()).sort()).toEqual(["1", "2"]);
    const d = solveCharacteristic([Rat.of(2), Rat.of(-1)]); // (r−1)²
    expect(d.roots).toHaveLength(1);
    expect(d.roots[0].mult).toBe(2);
    const f = solveCharacteristic([new Rat(1n, 2n), new Rat(1n, 2n)]); // r² − r/2 − 1/2 = (r−1)(r+1/2)
    expect(f.roots.map((x) => x.exact!.toString()).sort()).toEqual(["1", "−1/2"]);
  });
  it("Fibonacci roots are exact in Q(√5)", () => {
    const r = solveCharacteristic([Rat.of(1), Rat.of(1)]);
    expect(r.exactField).toBe(true);
    expect(r.D!.toString()).toBe("5");
    expect(r.roots.map((x) => x.exact!.toString()).sort()).toEqual(["(1/2 + √5/2)", "(1/2 − √5/2)"]);
  });
  it("complex roots are numeric and labelled", () => {
    const r = solveCharacteristic([Rat.of(0), Rat.of(-1)]); // r² + 1
    expect(r.exactField).toBe(false);
    expect(r.roots.map((x) => x.approx.im).sort()).toEqual([-1, 1]);
  });
});

describe("closed forms", () => {
  it("Fibonacci: Binet, exact, verified", () => {
    const r = run("a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1");
    expect(r.display[0]).toBe("a(n) = √5/5·(1/2 + √5/2)ⁿ − √5/5·(1/2 − √5/2)ⁿ");
    expect(r.display.join(" ")).toMatch(/First terms: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89/);
    expect(r.steps.join(" ")).toMatch(/Verified: the closed form reproduces a\(0\) … a\(15\) from direct iteration exactly/);
    expect(r.caveats.join(" ")).toMatch(/Exact in ℚ\(√5\)/);
  });
  it("distinct rational roots", () => {
    expect(closed("a(n) = 3a(n-1) - 2a(n-2), a(0)=0, a(1)=1")).toBe("a(n) = −(1)ⁿ + (2)ⁿ"); // 2^n − 1
    expect(run("a(n) = 3a(n-1) - 2a(n-2), a(0)=0, a(1)=1").display.join(" ")).toMatch(/First terms: 0, 1, 3, 7, 15, 31/);
  });
  it("repeated root gives the n·rⁿ term", () => {
    const r = run("a(n) = 2a(n-1) - a(n-2), a(0)=1, a(1)=3"); // a(n) = 1 + 2n
    expect(r.display[0]).toBe("a(n) = (1)ⁿ + 2·n·(1)ⁿ");
    expect(r.display.join(" ")).toMatch(/First terms: 1, 3, 5, 7, 9/);
    expect(r.steps.join(" ")).toMatch(/multiplicity 2/);
  });
  it("first order with constant forcing", () => {
    const r = run("a(n) = 2a(n-1) + 3, a(0)=1"); // a(n) = 4·2^n − 3
    expect(r.display[0]).toBe("a(n) = 4·(2)ⁿ − 3");
    expect(r.display.join(" ")).toMatch(/First terms: 1, 5, 13, 29, 61/);
    expect(r.steps.join(" ")).toMatch(/Verified/);
  });
  it("resonance: T(n) = T(n-1) + n gives n(n+1)/2", () => {
    const r = run("T(n) = T(n-1) + n, T(0) = 0");
    expect(r.display[0]).toBe("T(n) = n/2 + n²/2");
    expect(r.display.join(" ")).toMatch(/First terms: 0, 1, 3, 6, 10, 15/);
    expect(r.steps.join(" ")).toMatch(/resonance/);
  });
  it("exponential forcing with and without resonance", () => {
    const r = run("a(n) = 2a(n-1) + 2^n, a(0)=1"); // a(n) = 2^n + n 2^n
    expect(r.display.join(" ")).toMatch(/First terms: 1, 4, 12, 32, 80/);
    expect(r.steps.join(" ")).toMatch(/Verified/);
    const s = run("a(n) = 3a(n-1) + 2^n, a(0)=0"); // a(n) = 2·3^n − 2·2^n
    expect(s.display[0]).toBe("a(n) = 2·(3)ⁿ − 2·(2)ⁿ");
  });
  it("without initial conditions the general solution is given and the missing ones named", () => {
    const r = run("a(n) = a(n-1) + a(n-2)");
    expect(r.display[0]).toMatch(/^General solution: a\(n\) = C₁·\(/);
    expect(r.display[1]).toMatch(/Give 2 consecutive initial conditions \(a\(0\), a\(1\)\)/);
    expect(run("a(n) = a(n-1) + a(n-2), a(0)=1").display[1]).toMatch(/only a\(0\) given/);
  });
  it("complex roots: numeric closed form, still verified", () => {
    const r = run("a(n) = -a(n-2), a(0)=1, a(1)=0"); // 1, 0, −1, 0, 1, …
    expect(r.display.join(" ")).toMatch(/First terms: 1, 0, -1, 0, 1, 0, -1/);
    expect(r.caveats.join(" ")).toMatch(/Complex conjugate roots/);
    expect(r.steps.join(" ")).toMatch(/Verified/);
    expect(r.caveats.join(" ")).not.toMatch(/FAILED/);
  });
  it("an irreducible cubic goes numeric and verifies", () => {
    const r = run("a(n) = a(n-1) + a(n-2) + a(n-3), a(0)=0, a(1)=0, a(2)=1"); // tribonacci
    expect(r.display.join(" ")).toMatch(/First terms: 0, 0, 1, 1, 2, 4, 7, 13, 24, 44/);
    expect(r.caveats.join(" ")).toMatch(/Numeric closed form/);
    expect(r.steps.join(" ")).toMatch(/Verified/);
  });
  it("fractions stay exact", () => {
    const r = run("a(n) = a(n-1)/2 + 1, a(0) = 0".replace("a(n-1)/2", "1/2 a(n-1)"));
    expect(r.display[0]).toBe("a(n) = −2·(1/2)ⁿ + 2");
    expect(r.display.join(" ")).toMatch(/First terms: 0, 1, 3\/2, 7\/4, 15\/8/);
  });
});

describe("master theorem", () => {
  it("the three cases, from CLRS", () => {
    expect(closed("T(n) = 9T(n/3) + n")).toBe("Case 1: f(n) is polynomially smaller than n^(2) — T(n) = Θ(n^(2))");
    expect(closed("T(n) = T(2n/3) + 1".replace("2n/3", "n/1.5"))).toMatch(/Case 2/);
    expect(closed("T(n) = 2T(n/2) + n")).toBe("Case 2: f(n) = Θ(n) — T(n) = Θ(n log n)");
    expect(closed("T(n) = 3T(n/4) + n log n")).toBe("Case 3: f(n) is polynomially larger than n^0.7925 — T(n) = Θ(n log n)");
    expect(closed("T(n) = 8T(n/2) + n^2")).toBe("Case 1: f(n) is polynomially smaller than n^(3) — T(n) = Θ(n^(3))");
    expect(closed("T(n) = 2T(n/2) + n^2")).toBe("Case 3: f(n) is polynomially larger than n — T(n) = Θ(n^2)");
    expect(closed("T(n) = 2T(n/2) + n log n")).toBe("Case 2: f(n) = Θ(n log n) — T(n) = Θ(n log² n)"); // extended case 2
    expect(closed("T(n) = T(n/2) + 1")).toBe("Case 2: f(n) = Θ(1) — T(n) = Θ(log n)");
    expect(closed("T(n) = 4T(n/2) + n^3")).toMatch(/Case 3.*Θ\(n\^3\)/);
  });
  it("binary search and merge sort read naturally", () => {
    expect(run("T(n) = T(n/2) + 1").display[0]).toMatch(/Θ\(log n\)/);
    expect(run("T(n) = 2 T(n/2) + n").steps.join(" ")).toMatch(/log_b a = 1 \(exact\)/);
  });
  it("refuses f(n) outside the polynomial-log family and b ≤ 1", () => {
    expect(() => run("T(n) = 2T(n/2) + 2^n")).toThrow(/master theorem here needs f\(n\)/);
    expect(() => run("T(n) = 2T(n/1) + n")).toThrow(/b must be greater than 1/);
  });
});

describe("time", () => {
  it("is fast on the worst accepted inputs", () => {
    for (const s of ["a(n) = 7a(n-1) - 3a(n-2) + 5a(n-3) - a(n-4) + n^3 + 3^n, a(0)=1, a(1)=2, a(2)=3, a(3)=4", "a(n) = 1000000a(n-1) + 1000000, a(0)=1", "T(n) = 1000000T(n/1000000) + n^3"]) {
      const t0 = Date.now();
      try { run(s); } catch (e) { if (!(e instanceof DiscreteError)) throw e; }
      expect(Date.now() - t0).toBeLessThan(2000);
    }
  });
});
