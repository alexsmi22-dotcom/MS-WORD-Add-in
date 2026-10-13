// Elementary number theory (numtheory.ts). Oracles are textbook values and
// identities, never the engine's own output.

import {
  tryNumberTheory, gcd, egcd, modPow, modInverse, isPrime, factorize, totientFrom,
  divisorsFrom, sieve, multiplicativeOrder, jacobi, sqrtMod, MR_DETERMINISTIC_BOUND,
} from "../numtheory";
import { DiscreteError } from "../discrete";

const run = (s: string) => tryNumberTheory(s)!;
const head = (s: string) => run(s).display[0];

describe("core arithmetic", () => {
  it("gcd / egcd / inverse", () => {
    expect(gcd(84n, 36n)).toBe(12n);
    expect(gcd(0n, 5n)).toBe(5n);
    expect(gcd(-84n, 36n)).toBe(12n);
    const { g, s, t } = egcd(240n, 46n);
    expect(g).toBe(2n);
    expect(240n * s + 46n * t).toBe(2n);
    expect(modInverse(3n, 7n)).toBe(5n);
    expect(modInverse(6n, 9n)).toBeNull();
    expect(modInverse(-3n, 7n)).toBe(2n); // (−3)·2 = −6 ≡ 1
  });
  it("modPow", () => {
    expect(modPow(7n, 100n, 13n)).toBe(9n); // 7^12 ≡ 1, 100 = 8·12 + 4, 7^4 = 2401 ≡ 9
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
    expect(modPow(5n, 0n, 7n)).toBe(1n);
    expect(modPow(5n, 3n, 1n)).toBe(0n);
  });
  it("primality: small, Carmichael, large deterministic, probable", () => {
    expect(isPrime(97n).prime).toBe(true);
    expect(isPrime(1n).prime).toBe(false);
    expect(isPrime(561n).prime).toBe(false); // Carmichael number
    expect(isPrime(561n).factor).toBe(3n);
    expect(isPrime(1_000_003n).prime).toBe(true);
    expect(isPrime(2n ** 61n - 1n)).toEqual({ prime: true, certain: true }); // Mersenne prime M61 < bound
    const big = 2n ** 89n - 1n; // M89, prime, above the deterministic bound
    expect(big > MR_DETERMINISTIC_BOUND).toBe(true);
    expect(isPrime(big)).toEqual({ prime: true, certain: false });
    // A strong pseudoprime to base 2 is caught by the other bases.
    expect(isPrime(2047n).prime).toBe(false);
    expect(isPrime(3215031751n).prime).toBe(false); // spsp to bases 2,3,5,7
  });
  it("factorisation", () => {
    expect(factorize(360n).factors).toEqual([[2n, 3], [3n, 2], [5n, 1]]);
    expect(factorize(1n).factors).toEqual([]);
    expect(factorize(97n).factors).toEqual([[97n, 1]]);
    expect(factorize(1_000_000_007n * 998_244_353n).factors).toEqual([[998_244_353n, 1], [1_000_000_007n, 1]]);
    expect(factorize(1_000_003n ** 2n).factors).toEqual([[1_000_003n, 2]]); // perfect square beyond trial division
    const f = factorize(2n ** 32n + 1n); // F5 = 641 × 6700417 (Euler)
    expect(f.factors).toEqual([[641n, 1], [6700417n, 1]]);
    const f6 = factorize(2n ** 64n + 1n); // F6 = 274177 × 67280421310721 (Landry)
    expect(f6.factors).toEqual([[274177n, 1], [67280421310721n, 1]]);
  });
  it("totient, divisors, sieve, order", () => {
    expect(totientFrom(factorize(36n))).toBe(12n);
    expect(totientFrom(factorize(1n))).toBe(1n);
    expect(divisorsFrom(factorize(36n))).toEqual([1n, 2n, 3n, 4n, 6n, 9n, 12n, 18n, 36n]);
    expect(sieve(30)).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
    expect(sieve(100).length).toBe(25);
    expect(multiplicativeOrder(2n, 7n)).toBe(3n);
    expect(multiplicativeOrder(3n, 7n)).toBe(6n);
    expect(multiplicativeOrder(2n, 8n)).toBeNull();
    expect(multiplicativeOrder(10n, 7n)).toBe(6n); // period of 1/7
  });
  it("jacobi and modular square roots", () => {
    expect(jacobi(2n, 15n)).toBe(1); // the classic: +1 yet NOT a residue
    expect(jacobi(5n, 21n)).toBe(1);
    expect(jacobi(3n, 7n)).toBe(-1);
    expect(jacobi(2n, 7n)).toBe(1);
    expect([3n, 4n]).toContain(sqrtMod(2n, 7n)); // 3² = 9 ≡ 2, 4² = 16 ≡ 2
    expect(sqrtMod(3n, 7n)).toBeNull();
    const r = sqrtMod(10n, 13n) as bigint; // 13 ≡ 1 mod 4: Tonelli–Shanks path
    expect((r * r) % 13n).toBe(10n);
    expect(sqrtMod(0n, 7n)).toBe(0n);
  });
});

describe("surface forms", () => {
  it("gcd with Euclid steps and Bézout", () => {
    const r = run("gcd 84 36");
    expect(r.display[0]).toBe("gcd(84, 36) = 12");
    expect(r.display[1]).toBe("Bézout: 84 × (1) + 36 × (−2) = 12");
    expect(r.steps[0]).toBe("84 = 2 × 36 + 12");
    expect(r.steps.join(" ")).toMatch(/Verified/);
    expect(head("gcd(12, 18, 24)")).toBe("gcd(12, 18, 24) = 6");
    expect(head("hcf of 17 and 5".replace(" and ", " "))).toBe("gcd(17, 5) = 1");
    expect(run("gcd 17 5").display[2]).toMatch(/coprime/);
    expect(head("lcm 4 6")).toBe("lcm(4, 6) = 12");
    expect(head("lcm 2 3 4")).toBe("lcm(2, 3, 4) = 12");
  });
  it("mod, pow, inverse", () => {
    expect(head("17 mod 5")).toBe("17 mod 5 = 2");
    expect(head("-17 mod 5")).toBe("−17 mod 5 = 3");
    expect(head("7^100 mod 13")).toBe("7¹⁰⁰ ≡ 9 (mod 13)");
    expect(run("7^100 mod 13").display[1]).toMatch(/Fermat: 13 is prime/);
    expect(head("pow 2 10 mod 1000")).toBe("2¹⁰ ≡ 24 (mod 1,000)");
    expect(head("2^-1 mod 7")).toBe("2⁻¹ ≡ 4 (mod 7)");
    expect(head("inverse 3 mod 7")).toBe("3⁻¹ ≡ 5 (mod 7)");
    expect(() => run("inverse 6 mod 9")).toThrow(/gcd\(6, 9\) = 3/);
    expect(run("7^100 mod 13").steps.join(" ")).toMatch(/square-and-multiply/);
  });
  it("linear congruences and CRT", () => {
    expect(head("3x ≡ 2 mod 7")).toBe("x ≡ 3 (mod 7)");
    expect(head("solve 3x = 2 (mod 7)")).toBe("x ≡ 3 (mod 7)");
    const r = run("4x ≡ 2 mod 6"); // gcd 2 | 2: two solutions, 2 and 5
    expect(r.display[0]).toBe("x ≡ 2 (mod 3)");
    expect(r.display[1]).toMatch(/2 solutions mod 6: 2, 5/);
    expect(head("4x ≡ 3 mod 6")).toMatch(/NO solution/);
    expect(head("x ≡ 2 mod 3, x ≡ 3 mod 5, x ≡ 2 mod 7")).toBe("x ≡ 23 (mod 105)"); // Sunzi's problem
    expect(head("x = 1 mod 4, x = 3 mod 6")).toBe("x ≡ 9 (mod 12)"); // non-coprime, compatible
    expect(run("x = 1 mod 4, x = 3 mod 6").caveats.join(" ")).toMatch(/not pairwise coprime/);
    expect(head("x = 1 mod 4, x = 2 mod 6")).toMatch(/NO solution/);
    expect(run("x ≡ 2 mod 3, x ≡ 3 mod 5").steps.join(" ")).toMatch(/Verified/);
  });
  it("factor, prime, primes, phi, divisors", () => {
    expect(head("factor 360")).toBe("360 = 2³ × 3² × 5");
    expect(run("factor 360").display[1]).toBe("τ(n) = 24 divisors · σ(n) = 1,170 · φ(n) = 96");
    expect(head("factor 97")).toBe("97 = 97");
    expect(run("factor 97").display[2]).toBe("97 is prime.");
    expect(head("factor 1")).toBe("1 = 1");
    expect(head("prime factorization of 1001")).toBe("1,001 = 7 × 11 × 13");
    expect(head("is 97 prime")).toBe("97 is prime.");
    expect(head("is 561 prime?")).toBe("561 is composite.");
    expect(run("is 561 prime").steps[0]).toBe("561 = 3 × 187.");
    expect(head("is 1 prime")).toMatch(/not prime/);
    expect(head(`is ${2n ** 89n - 1n} prime`)).toMatch(/PROBABLE prime/);
    expect(head("primes to 30")).toMatch(/^10 primes up to 30/);
    expect(run("primes to 30").steps[0]).toBe("2, 3, 5, 7, 11, 13, 17, 19, 23, 29");
    expect(head("primes between 90 and 100")).toMatch(/^1 primes between 90 and 100/);
    expect(head("phi 36")).toBe("φ(36) = 12");
    expect(head("totient of 1")).toBe("φ(1) = 1");
    expect(head("divisors 28")).toMatch(/28 has 6 divisors; their sum σ\(n\) = 56 — a PERFECT number/);
    expect(head("divisors of 12")).toMatch(/abundant/);
  });
  it("order, primitive roots, jacobi, sqrt, bases", () => {
    expect(head("order of 2 mod 7")).toBe("ord_7(2) = 3");
    expect(run("order of 3 mod 7").display[1]).toMatch(/primitive root/);
    expect(() => run("order of 2 mod 8")).toThrow(/gcd\(2, 8\) = 2/);
    expect(head("primitive root mod 7")).toBe("Smallest primitive root mod 7: 3");
    expect(run("primitive roots mod 7").steps.join(" ")).toMatch(/All primitive roots: 3, 5\./);
    expect(head("primitive root mod 8")).toMatch(/No primitive root exists mod 8/);
    expect(head("primitive root mod 18")).toBe("Smallest primitive root mod 18: 5"); // 2·3²
    expect(head("jacobi 2 15")).toBe("(2 / 15) = 1");
    expect(run("jacobi 2 15").steps.join(" ")).toMatch(/does NOT prove/);
    expect(run("legendre 2 7").display[1]).toMatch(/IS a quadratic residue mod 7: 3² ≡ 2|IS a quadratic residue mod 7: 4² ≡ 2/);
    expect(() => run("legendre 2 15")).toThrow(/not prime/);
    expect(head("sqrt 2 mod 7")).toBe("x ≡ 3 or 4 (mod 7)");
    expect(head("x^2 = 3 mod 7")).toMatch(/not a quadratic residue/);
    expect(head("255 in binary")).toBe("255 (decimal) = 11111111 (binary)");
    expect(head("0xff to decimal")).toBe("0xff (hexadecimal) = 255 (decimal)");
    expect(head("hex ff to binary")).toBe("ff (hexadecimal) = 11111111 (binary)");
    expect(head("255 to base 7")).toBe("255 (decimal) = 513 (base 7)");
    expect(head("binary 1011 to decimal")).toBe("1011 (binary) = 11 (decimal)");
  });
  it("returns null for other engines' input", () => {
    for (const s of ["10 choose 3", "a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1", "(p -> q) & ~q", "A-B\nB-C", "hello", "dfa\nstates: q0", "x^2 - 5x + 6 = 0"]) {
      expect(tryNumberTheory(s)).toBeNull();
    }
  });
  it("refuses by name", () => {
    expect(() => run("17 mod 0")).toThrow(DiscreteError);
    expect(() => run("factor 0")).toThrow(/positive/);
    expect(() => run("primes to 2000000")).toThrow(/capped at 1,000,000/);
    expect(() => run(`gcd ${"9".repeat(4001)} 3`)).toThrow(/4000 digits/);
    expect(() => run("sqrt 2 mod 15")).toThrow(/composite/);
    expect(() => run("255 to base 40")).toThrow(/Bases 2 to 36/);
    expect(() => run("ff to binary")).toThrow(/which base/);
  });
  it("every cross-checkable form reports Verified and never CHECK FAILED", () => {
    for (const s of ["gcd 240 46", "7^100 mod 13", "inverse 17 mod 3120", "3x ≡ 2 mod 7", "x ≡ 2 mod 3, x ≡ 3 mod 5", "factor 123456789", "order of 10 mod 7", "sqrt 10 mod 13"]) {
      const r = run(s);
      expect(`${s}: ${r.caveats.join(" ")}`).not.toMatch(/FAILED/);
      expect(`${s}: ${r.steps.join(" ")}`).toMatch(/Verified/);
    }
  });
  it("is fast on the worst inputs", () => {
    for (const s of [`factor ${(2n ** 61n - 1n) * (2n ** 89n - 1n)}`, "factor 99999999999999999999999", "factor 999999999999999999999999999999999999999999999999999999999", `is ${2n ** 127n - 1n} prime`, "primes to 1000000", "7^99999999999999999999 mod 1000000007", `gcd ${"7".repeat(4000)} ${"3".repeat(3999)}`]) {
      const t0 = Date.now();
      try { run(s); } catch (e) { if (!(e instanceof DiscreteError)) throw e; }
      const ms = Date.now() - t0;
      expect(`${s.slice(0, 30)}: ${ms < 2000 ? "fast" : `SLOW ${ms}ms`}`).toBe(`${s.slice(0, 30)}: fast`);
    }
  });
  it("an unfactored cofactor is named, never called prime", () => {
    // Two ~30-digit primes: beyond rho's budget, and the display must say so.
    // M61 × M89: Pollard's rho needs ~√(2⁶¹) iterations for the smaller
    // factor, far past the budget, so the cofactor must come back unsplit.
    const r = run(`factor ${(2n ** 61n - 1n) * (2n ** 89n - 1n)}`);
    expect(r.caveats.join(" ")).toMatch(/composite \(Miller–Rabin\) but was not split within the budget/);
    expect(r.display[0]).toMatch(/= /);
    expect(r.steps.join(" ")).toMatch(/multiply back/);
    expect(r.display.join(" ") + r.caveats.join(" ")).not.toMatch(/is prime\./);
  });
});
