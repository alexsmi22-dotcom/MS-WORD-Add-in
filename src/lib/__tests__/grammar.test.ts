// Context-free grammars (grammar.ts) — every §D grammar value of
// docs/SCOPE-COMPUTATION-THEORY.md pinned verbatim, plus the exported helpers
// the pushdown engine calls (parseGrammar, cykMember).

import { solveGrammar, parseGrammar, cykMember, GRAMMAR_RE, printGrammar, toCnf, firstFollow, nullableSet } from "../grammar";
import { DiscreteError } from "../discrete";

const run = (s: string) => {
  const r = solveGrammar(s);
  if (!r) throw new Error("solveGrammar returned null for " + JSON.stringify(s));
  return r;
};
const all = (r: { display: string[]; steps: string[] }): string => [...r.display, ...r.steps].join("\n");

describe("§D: S -> aSb | ε with test: aabb ab aab ba \"\"", () => {
  const r = run('S -> aSb | ε\ntest: aabb ab aab ba ""');
  it("title and echo", () => {
    expect(r.title).toBe("Context-free grammar — 1 nonterminal, 2 productions over {a, b}");
    expect(r.display[0]).toBe("S → aSb | ε");
  });
  it("CNF: S₀ → ε | A X | A B, S → A X | A B, X → S B, A → a, B → b (new names said)", () => {
    const i = r.steps.findIndex((l) => l.startsWith("Chomsky normal form"));
    expect(r.steps.slice(i + 1, i + 6)).toEqual(["  S₀ → ε | A X | A B", "  S → A X | A B", "  X → S B", "  A → a", "  B → b"]);
    expect(all(r)).toMatch(/S₀ is the new start symbol/);
    expect(all(r)).toMatch(/A → a, B → b/);
    expect(all(r)).toMatch(/X → S B/);
  });
  it("CYK triangle for aabb", () => {
    const i = r.steps.indexOf("CYK table for aabb (row = span length, column = start position):");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(r.steps.slice(i + 1, i + 6)).toEqual([
      "  len 1: {A} {A} {B} {B}",
      "  len 2: ∅ {S₀,S} ∅",
      "  len 3: ∅ {X}",
      "  len 4: {S₀,S}",
      "  S₀ ∈ the top cell → accepted",
    ]);
  });
  it("verdicts, leftmost derivation, tree drawn with 7 nodes", () => {
    expect(r.display).toContain("aabb — accepted");
    expect(r.display).toContain("  S ⇒ aSb ⇒ aaSbb ⇒ aabb");
    expect(r.display).toContain("ab — accepted");
    expect(r.display).toContain("aab — rejected");
    expect(r.display).toContain("ba — rejected");
    expect(r.display).toContain('"" — accepted (the start symbol is nullable)');
    expect(r.svg).toBeDefined();
    expect(r.svg).toMatch(/parse tree of aabb \(7 nodes/);
    expect(all(r)).toMatch(/aabb: leftmost derivation in 3 steps; parse tree with 7 nodes/);
  });
  it("every verdict is cross-checked by the brute-force enumerator", () => {
    expect(r.steps.filter((l) => /cross-check .*: brute-force derivation search agrees/.test(l)).length).toBe(5);
  });
});

describe("§D: ε spellings and arrows read identically", () => {
  const base = run("S -> aSb | ε\ntest: aabb");
  for (const s of ["S → aSb | λ", "S -> aSb | eps", "S ::= aSb | epsilon", "cfg S -> aSb | ε", "S -> aSb | lambda", "grammar\nS -> aSb | ε"]) {
    it(s.replace(/\n/g, " ⏎ "), () => {
      const r = run(s + "\ntest: aabb");
      expect(r.title).toBe(base.title);
      expect(r.display).toEqual(base.display);
    });
  }
});

describe("§D: ambiguity", () => {
  it("S -> S S | a is AMBIGUOUS: aaa has 2 parse trees (aaaa has 5), both drawn", () => {
    const r = run("S -> S S | a\nis it ambiguous");
    expect(r.display).toContain("AMBIGUOUS: aaa has 2 parse trees");
    expect(r.steps.join("\n")).toMatch(/aaaa \(5 trees\)/);
    expect(r.svg).toMatch(/two parse trees of aaa/);
    expect((r.svg!.match(/>S<\/text>/g) ?? []).length).toBe(10); // 5 S nodes per tree
  });
  it("S -> aSb | ε: no witness ≤ 8 — evidence, not a proof", () => {
    const r = run("S -> aSb | ε\nambiguous?");
    expect(r.display.join("\n")).toMatch(/No ambiguous string of length ≤ 8 found — ambiguity is UNDECIDABLE in general, so this is evidence, not a proof\./);
    expect(r.svg).toBeUndefined();
  });
});

describe("§D: left recursion, FIRST/FOLLOW, nullable, useless", () => {
  it("expression grammar: E → T E', E' → + T E' | ε, T → F T', T' → * F T' | ε, F → ( E ) | id", () => {
    const r = run("E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id\nremove left recursion");
    const i = r.display.findIndex((l) => l.startsWith("Left recursion removed"));
    expect(r.display.slice(i + 1)).toEqual(["  E → T E'", "  E' → + T E' | ε", "  T → F T'", "  T' → * F T' | ε", "  F → ( E ) | id"]);
    expect(all(r)).toMatch(/new name E'/);
    expect(all(r)).toMatch(/new name T'/);
  });
  it("FIRST and FOLLOW of the LL(1) expression grammar", () => {
    const r = run("first and follow\nE -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id");
    const d = r.display;
    for (const nt of ["E", "T", "F"]) expect(d).toContain(`FIRST(${nt}) = {(, id}`);
    expect(d).toContain("FIRST(E') = {+, ε}");
    expect(d).toContain("FIRST(T') = {*, ε}");
    expect(d).toContain("FOLLOW(E) = {), $}");
    expect(d).toContain("FOLLOW(E') = {), $}");
    expect(d).toContain("FOLLOW(T) = {+, ), $}");
    expect(d).toContain("FOLLOW(T') = {+, ), $}");
    // §D lists {*, +, ), $}; the engine orders by first appearance — same set.
    const f = d.find((l) => l.startsWith("FOLLOW(F) = "))!;
    expect(new Set(f.slice(13, -1).split(", "))).toEqual(new Set(["*", "+", ")", "$"]));
  });
  it("nullable S -> AB, A -> a | ε, B -> b | ε → {A, B, S}", () => {
    expect(run("nullable S -> AB, A -> a | ε, B -> b | ε").display).toContain("nullable = {A, B, S}");
  });
  it("useless symbols: B is unreachable; reduced: S → A | a, A → a", () => {
    expect(run("S -> A | a\nA -> a\nB -> b\nuseless symbols").display).toContain("B is unreachable; reduced: S → A | a, A → a");
  });
});

describe("§D: derivations and multi-character symbols", () => {
  it("S -> 0S1 | 01, derivation of 0011 → S ⇒ 0S1 ⇒ 0011", () => {
    const r = run("S -> 0S1 | 01\nderivation of 0011");
    expect(r.display).toContain("  S ⇒ 0S1 ⇒ 0011");
    expect(all(r)).not.toMatch(/3x²|superscript/);
  });
  it("<expr> grammar, test: id+id → accepted, tree drawn with <expr> nodes", () => {
    const r = run("<expr> -> <expr> + <term> | <term>\n<term> -> id\ntest: id+id");
    expect(r.display).toContain("id+id — accepted");
    expect(r.svg).toContain("&lt;expr&gt;");
    expect(r.svg).toContain("&lt;term&gt;");
  });
});

describe("§D: equivalence is refused by name, with the sample comparison", () => {
  it("S -> aSb | ε vs S -> ab | aSb differ on \"\"", () => {
    expect(() => solveGrammar("is the grammar S -> aSb | ε equivalent to S -> ab | aSb")).toThrow(DiscreteError);
    expect(() => solveGrammar("is the grammar S -> aSb | ε equivalent to S -> ab | aSb")).toThrow(/undecidable[\s\S]*they differ on "" \(length 0\): the first accepts it, the second does not/);
  });
  it("agreeing grammars: the count of sampled strings is reported (63 = all of length ≤ 5 over {a, b}, ε included)", () => {
    expect(() => solveGrammar("is the grammar S -> aSb | ab | ε equivalent to S -> aSb | ε")).toThrow(/agree on all 63 strings of length ≤ 5 over \{a, b\} — evidence of equivalence, not a proof/);
  });
});

describe("§D: routing tie-breaks", () => {
  it("S -> aSb (one line) is a grammar with 'no test string', never a truth table", () => {
    const r = run("S -> aSb");
    expect(r.title).toMatch(/^Context-free grammar/);
    expect(r.display.join("\n")).toMatch(/No test string — add test:/);
  });
  it("S -> aSb ⏎ S -> ab is a grammar, never a graph", () => {
    expect(run("S -> aSb\nS -> ab").title).toBe("Context-free grammar — 1 nonterminal, 2 productions over {a, b}");
  });
  it("A -> B ⏎ B -> C (no terminal) and p -> q (lowercase LHS) are not grammars", () => {
    expect(solveGrammar("A -> B\nB -> C")).toBeNull();
    expect(solveGrammar("A->B\nB->C")).toBeNull();
    expect(solveGrammar("p -> q")).toBeNull();
  });
  it("GRAMMAR_RE matches the §D inputs and not the traps", () => {
    for (const s of ["S -> aSb | ε", "first and follow\nE -> T E'", "<expr> -> <term>", "S ::= aSb", "cfg S -> aSb", "nullable S -> AB, A -> a"]) expect(GRAMMAR_RE.test(s)).toBe(true);
    for (const s of ["p -> q", "(p -> q) & ~q -> ~p", "gcd 84 36", "dfa\nstates: q0"]) expect(GRAMMAR_RE.test(s)).toBe(false);
  });
});

describe("helpers for the pushdown engine", () => {
  it("parseGrammar reads the block and ignores question lines", () => {
    const g = parseGrammar("S -> aSb | ε\ntest: aabb");
    expect(g.start).toBe("S");
    expect(g.nonterminals).toEqual(["S"]);
    expect(g.terminals).toEqual(["a", "b"]);
    expect(g.productions).toEqual([{ lhs: "S", rhs: ["a", "S", "b"] }, { lhs: "S", rhs: [] }]);
    expect(parseGrammar("cfg to pda S -> aSb | ε").productions.length).toBe(2);
  });
  it("parseGrammar throws a DiscreteError on a bad grammar", () => {
    expect(() => parseGrammar("hello")).toThrow(DiscreteError);
    expect(() => parseGrammar("S -> a\nwhat is this")).toThrow(/neither a production/);
  });
  it("cykMember", () => {
    const g = parseGrammar("S -> aSb | ε");
    expect(cykMember(g, ["a", "a", "b", "b"])).toBe(true);
    expect(cykMember(g, [])).toBe(true);
    expect(cykMember(g, ["a", "b", "b"])).toBe(false);
    expect(cykMember(g, ["c"])).toBe(false);
  });
  it("the printer re-parses (display contract)", () => {
    const g = parseGrammar("S -> aSb | ε");
    expect(printGrammar(g)).toEqual(["S → aSb | ε"]);
    expect(parseGrammar(printGrammar(g).join("\n")).productions).toEqual(g.productions);
    expect(printGrammar(toCnf(g).g, true)).toEqual(["S₀ → ε | A X | A B", "S → A X | A B", "X → S B", "A → a", "B → b"]);
    expect(nullableSet(parseGrammar("S -> AB, A -> a | ε, B -> b | ε"))).toEqual(["A", "B", "S"]);
    expect(firstFollow(parseGrammar("S -> a")).follow.get("S")).toEqual(["$"]);
  });
});
