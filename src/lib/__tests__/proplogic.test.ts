// Propositional logic (proplogic.ts). Oracles: the classical argument forms
// and equivalences every logic course names.

import { tryPropLogic, parseFormula, show, evaluate, variablesOf } from "../proplogic";
import { DiscreteError } from "../discrete";

const run = (s: string) => tryPropLogic(s)!;
const verdict = (s: string) => run(s).display[1];

describe("parsing and rendering", () => {
  it("precedence: ¬ > ∧ > ∨ > → > ↔", () => {
    expect(show(parseFormula("~p & q | r -> s <-> t"))).toBe("¬p ∧ q ∨ r → s ↔ t"); // minimal: precedence carries it
    expect(show(parseFormula("(p | q) & r"))).toBe("(p ∨ q) ∧ r");
    expect(show(parseFormula("(p | q) xor r"))).toBe("(p ∨ q) ⊕ r");
    expect(show(parseFormula("p | q xor r"))).toBe("p ∨ q ⊕ r"); // xor binds tighter than or
    expect(show(parseFormula("(p -> q) -> r"))).toBe("(p → q) → r");
    expect(show(parseFormula("t & f"))).toBe("t ∧ f"); // variables, not constants
    expect(show(parseFormula("p -> q -> r"))).toBe("p → q → r"); // right-associative
    expect(evaluate(parseFormula("p -> q -> r"), { p: true, q: true, r: false })).toBe(false);
    expect(evaluate(parseFormula("(p -> q) -> r"), { p: true, q: true, r: false })).toBe(false);
    expect(evaluate(parseFormula("p -> (q -> r)"), { p: false, q: true, r: false })).toBe(true);
    expect(evaluate(parseFormula("(p -> q) -> r"), { p: false, q: true, r: false })).toBe(false);
  });
  it("accepts every spelling", () => {
    const forms = ["¬p ∧ q", "~p & q", "!p && q", "not p and q", "NOT p AND q"];
    for (const f of forms) expect(show(parseFormula(f))).toBe("¬p ∧ q");
    expect(show(parseFormula("p => q"))).toBe("p → q");
    expect(show(parseFormula("p iff q"))).toBe("p ↔ q");
    expect(show(parseFormula("p xor q"))).toBe("p ⊕ q");
    expect(show(parseFormula("p ⊃ q"))).toBe("p → q");
    expect(show(parseFormula("1 | 0"))).toBe("⊤ ∨ ⊥");
  });
  it("rendering parses back to the same table (display contract)", () => {
    for (const s of ["(p -> q) & ~q -> ~p", "p | q & r", "(p | q) & r", "~(p & q)", "p <-> q <-> r", "(p -> q) -> r", "p xor q | r", "a & b | a & ~b"]) {
      const f = parseFormula(s);
      const g = parseFormula(show(f));
      const vars = variablesOf(f);
      for (let i = 0; i < 1 << vars.length; i++) {
        const env: Record<string, boolean> = {};
        vars.forEach((v, b) => { env[v] = !!(i & (1 << b)); });
        expect(evaluate(g, env)).toBe(evaluate(f, env));
      }
    }
  });
  it("errors name the problem", () => {
    expect(() => parseFormula("p q")).toThrow(/no connective between them/);
    expect(() => parseFormula("(p -> q")).toThrow(/Missing "\)"/);
    expect(() => parseFormula("p ^ q")).toThrow(/ambiguous/);
    expect(() => parseFormula("p -> ")).toThrow(/ends too early/);
    expect(() => parseFormula("2p")).toThrow(/not a propositional variable/);
  });
});

describe("classification", () => {
  it("the classical tautologies", () => {
    expect(verdict("p | ~p")).toMatch(/^TAUTOLOGY/); // excluded middle
    expect(verdict("(p -> q) & ~q -> ~p")).toMatch(/^TAUTOLOGY/); // modus tollens
    expect(verdict("((p -> q) & (q -> r)) -> (p -> r)")).toMatch(/^TAUTOLOGY/); // hypothetical syllogism
    expect(verdict("((p -> q) -> p) -> p")).toMatch(/^TAUTOLOGY/); // Peirce's law
    expect(verdict("p & ~p")).toMatch(/^CONTRADICTION/);
    expect(verdict("p -> q")).toMatch(/^CONTINGENT — true in 3 of 4 rows/);
    expect(verdict("(p -> q) & ~p -> ~q")).toMatch(/^CONTINGENT/); // denying the antecedent is NOT valid
  });
  it("verbs answer their question", () => {
    expect(run("tautology? p | ~p").display[2]).toBe("Yes: it is a tautology.");
    expect(run("satisfiable p & ~p").display[2]).toBe("No: it is unsatisfiable.");
    expect(run("valid (p -> q) & ~p -> ~q").display[2]).toBe("No: it is not a tautology.");
  });
  it("table rows are in textbook order (first variable most significant, T first)", () => {
    const r = run("p -> q");
    const rows = r.steps.slice(2, 6);
    expect(rows.map((l) => l.replace(/\s/g, ""))).toEqual(["T│T│T", "T│F│F", "F│T│T", "F│F│T"]);
  });
  it("satisfying assignments are listed when few", () => {
    expect(run("p & q").display[2]).toBe("Satisfying assignments: p=T q=T.");
  });
});

describe("normal forms", () => {
  it("DNF from true rows, CNF from false rows, minimal DNF via Quine–McCluskey", () => {
    const r = run("a & b | a & ~b");
    const s = r.steps.join("\n");
    expect(s).toMatch(/DNF \(from the true rows\): \(a ∧ b\) ∨ \(a ∧ ¬b\)/);
    expect(s).toMatch(/CNF \(from the false rows\): \(a ∨ ¬b\) ∧ \(a ∨ b\)/);
    expect(s).toMatch(/Minimal DNF \(Quine–McCluskey\): a  — 1 literal/);
    expect(s).toMatch(/Verified: the minimal form has the same truth table/);
    expect(run("simplify a & b | a & ~b").display.join(" ")).toMatch(/Simplest sum of products: a/);
    expect(run("simplify p | ~p").display.join(" ")).toMatch(/Simplest form: ⊤/);
  });
  it("De Morgan as an equivalence question", () => {
    expect(verdict("~(p & q) == ~p | ~q")).toMatch(/^EQUIVALENT/);
    expect(verdict("~(p & q) ≡ ~p & ~q")).toMatch(/^NOT equivalent/);
    expect(run("~(p & q) ≡ ~p & ~q").display[2]).toMatch(/Differ at p = T, q = F/);
    expect(verdict("p -> q == ~p | q")).toMatch(/^EQUIVALENT/);
    expect(verdict("p -> q equiv ~q -> ~p")).toMatch(/^EQUIVALENT/); // contrapositive
    expect(verdict("p -> q equiv q -> p")).toMatch(/^NOT equivalent/); // converse
  });
  it("multi-letter variables survive minimisation", () => {
    const r = run("simplify rain & wet | rain & ~wet");
    expect(r.display.join(" ")).toMatch(/Simplest sum of products: rain/);
  });
});

describe("entailment", () => {
  it("modus ponens is valid, affirming the consequent is not", () => {
    expect(verdict("p -> q, p |= q")).toMatch(/^VALID/);
    const r = run("p -> q, q ⊢ p");
    expect(r.display[1]).toMatch(/^INVALID: 1 counterexample row/);
    expect(r.display[2]).toBe("Counterexample: p = F, q = T — all premises true, conclusion false.");
    expect(verdict("p | q, ~p therefore q")).toMatch(/^VALID/); // disjunctive syllogism
    expect(verdict("p -> q, q -> r |= p -> r")).toMatch(/^VALID/);
    expect(run("p -> q, p |= q").steps[0]).toMatch(/P1 │ P2 │ conclusion/);
  });
  it("no premises asks about a tautology", () => {
    const r = run("|= p | ~p");
    expect(r.display[1]).toMatch(/^VALID/);
    expect(r.caveats.join(" ")).toMatch(/No premises/);
  });
});

describe("claiming and refusing", () => {
  it("returns null for other engines' input and for prose", () => {
    for (const s of ["gcd 84 36", "10 choose 3", "a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1", "A-B\nB-C", "dfa\nstates: q0", "how many ways to choose 3 of 10 or 4 of 12", "hello", "x^2 - 5x + 6 = 0"]) {
      expect(tryPropLogic(s)).toBeNull();
    }
  });
  it("a strong symbol with a broken formula is an error, not silence", () => {
    expect(() => run("p -> ")).toThrow(DiscreteError);
    expect(() => run("p -> q, r")).toThrow(/Commas separate premises/);
  });
  it("the variable cap is named", () => {
    const f = "abcdefghijk".split("").join(" & ");
    expect(() => run(f)).toThrow(/11 variables is above the 10-variable cap/);
    const t0 = Date.now();
    run("abcdefghij".split("").join(" & "));
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("more than 32 rows are summarised, not listed", () => {
    const r = run("a | b | c | d | e | f");
    expect(r.steps.join("\n")).toMatch(/32 more rows not listed/);
    expect(r.display[1]).toMatch(/true in 63 of 64 rows/);
  });
});
