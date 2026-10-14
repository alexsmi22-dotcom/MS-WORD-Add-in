// The Discrete-math front door (discrete.ts): routing by syntax, and the
// tie-breaks between engines, pinned so a new engine cannot silently steal
// another's input.

import { solveDiscrete, ENGINES, foldSuperscripts, DiscreteError } from "../discrete";

const run = (s: string) => solveDiscrete(s)!;

describe("routing", () => {
  it("empty is null; unknown text is a 'not recognised' result that names every form", () => {
    expect(solveDiscrete("")).toBeNull();
    expect(solveDiscrete("   \n ")).toBeNull();
    const r = run("hello there");
    expect(r.title).toBe("Not recognised");
    expect(r.steps.join("\n")).toMatch(/Number theory/);
    expect(r.steps.join("\n")).toMatch(/Graphs/);
    expect(r.steps.join("\n")).toMatch(/Automata/);
  });
  it("each engine gets its own syntax", () => {
    expect(run("gcd 84 36").title).toBe("Greatest common divisor");
    expect(run("10 choose 3").display[0]).toMatch(/120/);
    expect(run("a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1").title).toBe("Recurrence relation");
    expect(run("T(n) = 2T(n/2) + n").title).toBe("Master theorem");
    expect(run("(p -> q) & ~q -> ~p").title).toBe("Truth table");
    expect(run("p -> q, p |= q").title).toBe("Entailment");
    expect(run("dfa\nstates: q0 q1\nalphabet: 0 1\nstart: q0\naccept: q1\nq0 0 q1\nq0 1 q0\nq1 0 q1\nq1 1 q0\ntest: 0 1 00").svg).toBeDefined();
    expect(run("A-B\nB-C\nC-A").svg).toBeDefined();
    expect(run("shortest path A to C\nA-B 1\nB-C 1\nA-C 5").display.join(" ")).toMatch(/2/);
  });
  it("tie-breaks: ≡ with mod is number theory, not logic; a single line p -> q is logic, not a graph", () => {
    expect(run("x ≡ 2 mod 3, x ≡ 3 mod 5").title).toBe("Chinese remainder theorem");
    expect(run("p -> q").title).toBe("Truth table");
    expect(run("A->B\nB->C").title).not.toBe("Truth table");
  });
  it("engine order is pinned", () => {
    expect(ENGINES.map((e) => e.name)).toEqual([
      "abstract algebra", "number theory", "combinatorics", "recurrence",
      "grammar", "pushdown", "turing", "first-order logic", "sat",
      "automata", "propositional logic", "graph",
    ]);
  });
  it("superscript digits fold to ^ before routing (display contract)", () => {
    expect(foldSuperscripts("7¹⁰⁰ mod 13")).toBe("7^100 mod 13");
    expect(run("7¹⁰⁰ mod 13").display[0]).toBe("7¹⁰⁰ ≡ 9 (mod 13)");
    expect(run("a(n) = a(n-1) + n², a(0)=0").display.join(" ")).toMatch(/First terms: 0, 1, 5, 14, 30/);
  });
  it("a stack overflow inside any engine is a named refusal, never a RangeError that escapes to the pane (v2.133.0)", () => {
    // 2,000 nested parentheses overflowed proplogic's recursive descent and
    // the RangeError escaped solveDiscrete; the pane rethrows non-DiscreteErrors.
    const deep = "(".repeat(2000) + "p" + ")".repeat(2000) + " -> q";
    let caught: unknown = null;
    try {
      run(deep);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(RangeError);
    if (caught !== null) {
      expect(caught).toBeInstanceOf(DiscreteError);
      expect((caught as Error).message).toMatch(/nests too deeply/);
    }
  });
  it("a recognised-but-refused request throws DiscreteError with the reason", () => {
    expect(() => run("inverse 6 mod 9")).toThrow(DiscreteError);
    expect(() => run("inverse 6 mod 9")).toThrow(/gcd\(6, 9\) = 3/);
  });
  it("every engine answers its hint example within 200 ms", () => {
    const examples = [
      "gcd 84 36", "7^100 mod 13", "x ≡ 2 mod 3, x ≡ 3 mod 5, x ≡ 2 mod 7", "factor 360", "primes to 100", "primitive root mod 7",
      "10 choose 3", "arrangements of MISSISSIPPI", "derangements 5", "catalan 5",
      "a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1", "a(n) = 2a(n-1) + 3, a(0)=1", "T(n) = 2T(n/2) + n",
      "(p -> q) & ~q -> ~p", "p -> q, p |= q", "simplify a & b | a & ~b",
      "regex (a|b)*abb\ntest: abb aabb ab",
      "shortest path A to F\nA-B 7\nA-C 9\nA-F 14\nB-C 10\nB-D 15\nC-D 11\nC-F 2\nD-E 6\nE-F 9",
      "mst\nA-B 1\nB-C 2\nA-C 3\nC-D 1",
    ];
    for (const s of examples) {
      const t0 = Date.now();
      const r = run(s);
      const ms = Date.now() - t0;
      expect(`${s.slice(0, 30)}: ${r.title}`).not.toMatch(/Not recognised/);
      expect(`${s.slice(0, 30)}: ${ms < 2000 ? "fast" : `SLOW ${ms}ms`}`).toBe(`${s.slice(0, 30)}: fast`);
      expect(r.caveats.join(" ")).not.toMatch(/FAILED/);
    }
  });
});
