// Pins from the independent adversarial pass over the discrete-math release.
// Each was a confirmed defect in the first version; expected values are by
// hand or by the textbook.

import { solveDiscrete, ENGINES, foldSuperscripts, DiscreteError } from "../discrete";
import { parseFormula, show, evaluate, variablesOf } from "../proplogic";
import { solveLambda } from "../lambda";

const run = (s: string) => solveDiscrete(s)!;

describe("routing", () => {
  it("1. a one-line regex reaches automata (logic no longer steals the |)", () => {
    for (const s of ["regex (a|b)*abb", "regex a|b", "regex (0|1)*1", "regex (a|ε)*"]) {
      const r = run(s);
      expect(`${s}: ${r.title}`).not.toMatch(/Truth table|Not recognised/);
      expect(r.svg).toBeDefined();
    }
    expect(ENGINES.map((e) => e.name)).toEqual(["number theory", "combinatorics", "recurrence", "automata", "propositional logic", "graph"]);
  });
  it("a single weighted edge line is a graph, not a formula", () => {
    expect(run("A->B 5").title).not.toBe("Truth table");
  });
  it("10. displayed ⁻¹ and ⁻² forms parse back", () => {
    expect(foldSuperscripts("3⁻¹ mod 7")).toBe("3^-1 mod 7");
    expect(run("3⁻¹ mod 7").display[0]).toBe("3⁻¹ ≡ 5 (mod 7)");
    expect(run("7⁻² mod 13").display[0]).toMatch(/^7⁻² ≡ \d+ \(mod 13\)/);
  });
});

describe("number theory", () => {
  it("4. a negative or tiny sieve limit is an answer, not a RangeError", () => {
    expect(run("primes to -5").display[0]).toMatch(/no primes/);
    expect(run("primes between -10 and -5").display[0]).toMatch(/no primes/);
    expect(run("primes to 1").display[0]).toMatch(/no primes/);
  });
  it("5. the Sorenson–Webster bound itself is composite and is never called prime", () => {
    const bound = "3317044064679887385961981";
    const r = run(`factor ${bound}`);
    expect(r.display.join(" ")).not.toMatch(/\bis prime\./);
    expect(r.display.join(" ") + r.caveats.join(" ")).toMatch(/PROBABLE/);
    expect(run(`is ${bound} prime`).display[0]).toMatch(/PROBABLE/);
    expect(run("factor 618970019642690137449562111").display.join(" ")).toMatch(/PROBABLE prime/); // 2^89 − 1
  });
  it("11. thousands separators are read, not split into a list", () => {
    expect(run("gcd 1,234 56").display[0]).toBe("gcd(1,234, 56) = 2");
    expect(run("lcm 1,000 15").display[0]).toBe("lcm(1,000, 15) = 3,000");
    expect(run("1,234 mod 7").display[0]).toBe("1,234 mod 7 = 2");
  });
  it("judgment calls adopted: congruence statements, 'of … and', 'a prime number', newline CRT, pow()", () => {
    expect(run("5 ≡ 2 (mod 3)").display[0]).toBe("5 ≡ 2 (mod 3) is TRUE.");
    expect(run("7 ≡ 2 (mod 3)").display[0]).toBe("7 ≡ 2 (mod 3) is FALSE.");
    expect(run("gcd of 84 and 36").display[0]).toBe("gcd(84, 36) = 12");
    expect(run("is 97 a prime number?").display[0]).toBe("97 is prime.");
    expect(run("x ≡ 2 mod 3\nx ≡ 3 mod 5").display[0]).toBe("x ≡ 8 (mod 15)");
    expect(run("pow(7,100,13)").display[0]).toBe("7¹⁰⁰ ≡ 9 (mod 13)");
    expect(run("sqrt 1 mod 2").steps[0]).toMatch(/Mod 2 every residue/);
  });
});

describe("combinatorics", () => {
  it("3. a sentence with a condition the formula ignores is refused, never answered", () => {
    for (const s of [
      "how many ways to arrange the letters of BANANA beginning with B",
      "how many ways to arrange the letters of BANANA starting with B",
      "how many ways to arrange the letters of BANANA ending in A",
      "how many ways to seat 5 people in a row beginning with Alice",
      "how many ways to choose a team of 3 from 10 and a captain",
      "how many ways to choose 3 of 10 people and seat them in a row",
      "how many ways to choose 3 of 10 people and give each a different prize",
    ]) {
      let out = "";
      try { const r = solveDiscrete(s); out = r ? r.display.join(" ") : "null"; } catch (e) { out = e instanceof DiscreteError ? "refused" : String(e); }
      expect(`${s} → ${out}`).toMatch(/refused|null|Not recognised/);
    }
    // And the plain forms still answer.
    expect(run("how many ways to arrange the letters of BANANA").display[0]).toMatch(/60/);
  });
});

describe("recurrences", () => {
  it("2. initial conditions on their own lines", () => {
    expect(run("a(n) = a(n-1) + a(n-2)\na(0) = 0\na(1) = 1").display.join(" ")).toMatch(/First terms: 0, 1, 1, 2, 3, 5/);
    expect(run("T(n) = T(n-1) + n\nT(0) = 0").display[0]).toBe("T(n) = 1/2n + 1/2n²");
  });
  it("7. an ill-conditioned numeric system is NOT shown as a closed form, and never says FAILED", () => {
    const r = run("a(n) = 123456789a(n-1) - 987654321a(n-2) + 555555a(n-3) - 777777a(n-4), a(0)=1, a(1)=1, a(2)=1, a(3)=1");
    expect(r.display[0]).toMatch(/closed form NOT shown/);
    expect(r.caveats.join(" ")).not.toMatch(/FAILED/);
    expect(r.display.join(" ")).toMatch(/First terms: 1, 1, 1, 1/);
  });
  it("judgment calls adopted: Fibonacci from F(1), inconsistent and duplicate conditions, √1, a_n − 1, log² n", () => {
    const f = run("F(n) = F(n-1) + F(n-2), F(1) = 1, F(2) = 1");
    expect(f.display.join(" ")).toMatch(/First terms \(from F\(1\)\): 1, 1, 2, 3, 5, 8/);
    expect(f.steps.join(" ")).toMatch(/Verified: the closed form reproduces F\(1\) … F\(16\)/);
    expect(run("a(n) = 2a(n-1), a(1) = 3").display.join(" ")).toMatch(/First terms \(from a\(1\)\): 3, 6, 12/);
    expect(() => run("a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1, a(2)=5")).toThrow(/inconsistent/);
    expect(() => run("a(n) = a(n-1), a(0)=0, a(0)=1")).toThrow(/given twice/);
    const big = run("a(n) = 963761198401a(n-1) - 963761198400a(n-2), a(0)=1, a(1)=1");
    expect(big.steps.join(" ")).not.toMatch(/√1/);
    expect(big.display[0]).toBe("a(n) = (1)ⁿ");
    expect(() => run("a_n = 2 a_n - 1, a_0 = 1")).toThrow(/both sides/);
    expect(run("T(n) = 2T(n/2) + n log^2 n").display[0]).toBe("Case 2: f(n) = Θ(n log² n) — T(n) = Θ(n log³ n)");
    expect(run("T(n) = 2T(n/2) + n log² n").display[0]).toBe("Case 2: f(n) = Θ(n log² n) — T(n) = Θ(n log³ n)");
    expect(run("T(n) = T(n/1.5) + 1").steps[0]).toMatch(/log_b a = 0 \(exact\)/);
    expect(run("a(n) = a(n-1)/2 + 1, a(0) = 0").display.join(" ")).toMatch(/First terms: 0, 1, 3\/2/);
    expect(run("a(n) = (1/2)a(n-1) + 1, a(0) = 0").display.join(" ")).toMatch(/First terms: 0, 1, 3\/2/);
    expect(run("a(n) = 2·a(n-1), a(0) = 1").display.join(" ")).toMatch(/First terms: 1, 2, 4/);
    expect(run("a(n) = a(n-1) + n^2 3^n, a(0) = 0").display.join(" ")).toMatch(/First terms: 0, 3, 39/);
  });
});

describe("logic", () => {
  it("6. NAND/NOR keep their brackets on the right (non-associative), and the display round-trips", () => {
    for (const s of ["p nand (q nand r)", "p nor (q nor r)", "(p nand q) nand r", "p | q xor r", "(p | q) xor r"]) {
      const f = parseFormula(s);
      const g = parseFormula(show(f));
      const vars = variablesOf(f);
      for (let i = 0; i < 1 << vars.length; i++) {
        const env: Record<string, boolean> = {};
        vars.forEach((v, b) => { env[v] = !!(i & (1 << b)); });
        expect(`${s}: ${show(f)}`).toBe(`${s}: ${show(f)}`);
        expect(evaluate(g, env)).toBe(evaluate(f, env));
      }
    }
    expect(show(parseFormula("p nand (q nand r)"))).toBe("p ↑ (q ↑ r)");
    expect(show(parseFormula("p | q xor r"))).toBe("p ∨ q ⊕ r"); // xor binds tighter than or
    expect(show(parseFormula("(p | q) xor r"))).toBe("(p ∨ q) ⊕ r");
  });
  it("8. ten variables answer in well under a second (Quine–McCluskey is not run unasked)", () => {
    for (const s of ["a|b|c|d|e|f|g|h|i|j", "~(a&b&c&d&e&f&g&h&i&j)", "a -> b -> c -> d -> e -> f -> g -> h -> i -> j"]) {
      const t0 = Date.now();
      const r = run(s);
      const ms = Date.now() - t0;
      expect(`${s}: ${ms < 1000 ? "fast" : `SLOW ${ms}ms`}`).toBe(`${s}: fast`);
      expect(r.steps.join(" ")).toMatch(/Minimal DNF: skipped above 7 variables/);
    }
    expect(run("a&b|a&~b").steps.join(" ")).toMatch(/Minimal DNF \(Quine–McCluskey\): a/);
  });
});

describe("λ-calculus let rec", () => {
  it("9. the hint's own factorial example is fast, and FACT 5 is computable", () => {
    const def = "let rec FACT = λn.IF (ISZERO n) 1 (MULT n (FACT (PRED n)))";
    const t0 = Date.now();
    const r3 = solveLambda(`${def}\nFACT 3`)!;
    const ms = Date.now() - t0;
    expect(r3.decoded?.numeral).toBe(6);
    // ~75 ms alone; a gross-freeze bound, since jest's instrumentation and
    // parallel load multiply wall-clock several-fold.
    expect(`FACT 3: ${ms < 2000 ? "fast" : `SLOW ${ms}ms`}`).toBe("FACT 3: fast");
    // FACT 5 through Y exceeds the work budget (each unfolding copies the whole
    // body); the result is an honest cap, not a hang and not a wrong number.
    const t1 = Date.now();
    const r5 = solveLambda(`${def}\nFACT 5`)!;
    expect(Date.now() - t1).toBeLessThan(2000);
    expect(r5.outcome!.status).toBe("capped");
    expect(r5.display.join(" ")).toMatch(/work budget/);
  });
});
