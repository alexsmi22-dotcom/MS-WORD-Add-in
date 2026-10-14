// Independent adversarial review of v2.133.0 (computation theory: grammars,
// PDA, Turing machines, first-order logic, SAT, Hindley–Milner).
//
// Plain `it` = a WRONG answer, a STEAL or a HANG: it FAILS until fixed.
// `it.failing` = a refusal where an answer exists, or a cosmetic slip: it
// PASSES today (the correct expectation throws) and flips to a failure once
// fixed — then turn it into a plain `it`.
//
// Oracles were independent of the modules: an exact language fixpoint for
// CFG membership, exact parse-tree counting for ambiguity, a fixpoint
// FIRST/FOLLOW, a configuration BFS for PDAs, a full-configuration TM stepper,
// a Robinson unifier, truth tables for ground resolution, brute-force SAT.
// 4,650 membership checks, 200 ambiguity grammars, 200 FIRST/FOLLOW grammars,
// 2,200 PDA runs, 299 TM runs, 277 unifications, 200 resolution arguments,
// 900 DPLL/2-SAT/Horn runs and 250 HM-vs-expansion terms agreed; what is
// pinned below is what did not.

import { solveDiscrete, DiscreteError, DiscreteResult } from "../discrete";
import { GRAMMAR_RE } from "../grammar";
import { PDA_RE } from "../pda";
import { TM_RE } from "../turing";
import { FOL_RE } from "../fol";
import { SAT_RE } from "../sat";
import { HM_RE, solveLambda } from "../lambda";
import { computationKindFor } from "../ctSwitch";

function disc(s: string): DiscreteResult {
  const r = solveDiscrete(s);
  if (!r) throw new Error("null");
  return r;
}
const text = (r: DiscreteResult): string => [...r.display, ...r.steps].join("\n");

/** The equation kind's computation-theory switch — the SAME function the pane
 *  calls (ctSwitch.ts), no longer a hand-copied mirror. */
const equationKindSwitches = (raw: string): "discrete" | "lambda" | null => computationKindFor(raw);

// ---------------------------------------------------------------------------
// WRONG ANSWERS
// ---------------------------------------------------------------------------

describe("wrong answers", () => {
  it("a duplicated production is not ambiguity (S -> a | a prints as S → a, which has ONE parse tree)", () => {
    // Today: "AMBIGUOUS: a has 2 parse trees · 1. S ⇒ a · 2. S ⇒ a" — two
    // IDENTICAL derivations offered as a proof, under a printed grammar
    // (S → a) that is plainly unambiguous. The header also says
    // "2 productions" while the printer shows one. 10 of 200 random grammars
    // hit this (any repeated alternative, e.g. B -> a | a | a).
    const r = disc("S -> a | a\nis it ambiguous");
    expect(r.display.join("\n")).not.toMatch(/AMBIGUOUS: /);
    const r2 = disc("S -> a b | a b\nis it ambiguous");
    expect(r2.display.join("\n")).not.toMatch(/AMBIGUOUS: /);
  });

  it("test strings are split against the GRAMMAR, not by greedy longest match (abc = a·bc is in the language)", () => {
    // Today: 'abc — rejected: "c" is not a terminal of this grammar' — the
    // splitter took "ab" first. Oracle: S ⇒ "a" "bc" = abc.
    for (const g of ['S -> "a" "bc" | "ab" "x"', 'S -> "ab" "x" | "a" "bc"']) {
      const r = disc(`${g}\ntest: abc`);
      expect(r.display.find((l) => l.startsWith("abc —"))).toMatch(/accepted/);
    }
  });
});

// ---------------------------------------------------------------------------
// STEALS — the equation kind (pane switch, mirrored)
// ---------------------------------------------------------------------------

describe("the equation kind keeps ordinary equations", () => {
  // keywordLed switches on ANY DiscreteError, including the propositional or
  // graph engine's — and GRAMMAR_RE has no keyword at all (any line "X -> …").
  it.each([
    "tm = 5",
    "TM = 3x + 1",
    "tm + 2 = 7",
    "tm(x) = 2x",
    "turing = 4",
    "pda = 3",
    "pda + 1 = 4",
    "pushdown = 7",
    "horn = 2",
    "Horn x = 4",
    "dpll = 3",
    "dimacs = 2",
    "2-sat x = 4",
    "X -> 0",
    "N -> infinity",
    "E -> mc^2",
    "R -> R + dR",
    "T -> 2T + 1",
    "Y -> 3x + 2y",
    "V -> 5 when R = 2",
    "F -> 0 as x -> infinity",
    "Q = 5\nP -> 2",
  ])("%j is not switched to the Discrete kind", (s) => {
    expect(equationKindSwitches(s)).toBeNull();
  });

  it("an hm FAILURE is not an answer: 'w x' must not switch the equation kind to λ", () => {
    // The λ switch tests only the title, and a failed inference carries the
    // same title "Hindley–Milner type" ("Not typable: unbound variable x").
    expect(equationKindSwitches("w x")).toBeNull();
    expect(equationKindSwitches("w y z")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// STEALS — inside the Discrete kind (old engines lose their input)
// ---------------------------------------------------------------------------

describe("old discrete engines keep their input", () => {
  it("digit-suffixed vertex names stay a GRAPH (X1 -> X2 ⏎ X2 -> X3 was a 3-vertex digraph)", () => {
    // Today: "Context-free grammar — 3 nonterminals, 2 productions over {3}"
    // and the second line is MISREAD as "X2 → X 3" (X3 split into X and 3)
    // while X2 on line 1 is kept whole.
    expect(disc("X1 -> X2\nX2 -> X3").title).toBe("Graph");
    expect(disc("A1 -> B1\nB1 -> C1").title).toBe("Graph");
    // One line: was a truth table over S1, S2; now "S1 → S 2" (S2 split).
    expect(disc("S1 -> S2").title).toBe("Truth table");
  });

  it("an entailment with a word turnstile stays logic (A -> b, A therefore b is VALID)", () => {
    // Today: a grammar over {b, ",", therefore} — "A → b "," A therefore b".
    expect(disc("A -> b, A therefore b").title).toBe("Entailment");
    expect(disc("A -> b, A entails b").title).toBe("Entailment");
  });
});

// ---------------------------------------------------------------------------
// STEAL — the λ kind
// ---------------------------------------------------------------------------

describe("the λ kind", () => {
  it("a free variable named w applied to something still REDUCES (w x was β-reduction before v2.133.0)", () => {
    // Today: "Hindley–Milner type · Not typable: unbound variable x".
    const r = solveLambda("w x")!;
    expect(r.title).toBe("β-reduction");
  });
});

// ---------------------------------------------------------------------------
// HANG — every input < 1 s alone
// ---------------------------------------------------------------------------

describe("time", () => {
  it("an infinite Herbrand universe with an unrelated goal answers within 1 s", () => {
    // Measured 1.75–2.1 s alone (the answer, INVALID with a 1-element
    // countermodel, is right; the saturation runs to its cap first).
    const t0 = Date.now();
    const r = disc("resolve ∀x (P(x) → P(f(x))), P(a) ⊢ Q(a)");
    expect(r.display.join(" ")).toMatch(/INVALID/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// REFUSALS WHERE AN ANSWER EXISTS (it.failing: passes today)
// ---------------------------------------------------------------------------

describe("refusals where an answer exists", () => {
  it("↔ under a quantifier (or in resolve) is answered, not 'Internal: ↔ with quantifiers should have been expanded'", () => {
    // clausal form and prenex of the same formulas already work.
    const valid = (s: string) => {
      const d = disc(s).display.join(" ");
      expect(d).toMatch(/\bVALID\b/);
      expect(d).not.toMatch(/INVALID/);
    };
    valid("resolve ∀x (P(x) ↔ Q(x)), P(a) ⊢ Q(a)");
    disc("∀x (P(x) ↔ Q(x))");
    disc("skolemize ∀x (P(x) ↔ Q(x))");
    valid("is ∀x (P(x) ↔ P(x)) valid");
    valid("resolve P(a) ↔ Q(a), P(a) ⊢ Q(a)");
  });

  it("an argument whose clause set is all tautologies still gets a verdict (INVALID)", () => {
    // Today: "No clauses: every formula is a tautology, so the set is
    // trivially satisfiable." — true, but the argument's verdict is never said.
    expect(disc("resolve (P(a) ∨ ¬P(a)) ⊢ (¬P(a) ∧ P(a))").display.join(" ")).toMatch(/INVALID/);
  });

  it("§D: 'is (a ∨ b) ∧ (¬a ∨ ¬b) satisfiable' answers yes (it is refused 'Two things side by side')", () => {
    const d = disc("is (a ∨ b) ∧ (¬a ∨ ¬b) satisfiable").display.join(" ");
    expect(d).toMatch(/Yes|a=T b=F|a=F b=T/);
    expect(d).not.toMatch(/unsat|No:/i);
  });

  it("lowercase multi-letter free variables applied to arguments still reduce (pair a b, fst p, succ 2, plus 2 3, map f xs)", () => {
    // Today each is refused '"pair" reads as prose … Library names are
    // UPPERCASE: PAIR'. Before v2.133.0 each reduced (free variable applied).
    for (const s of ["pair a b", "fst p", "succ 2", "plus 2 3", "map f xs"]) {
      expect(solveLambda(s)!.title).toBe("β-reduction");
    }
  });
});

// ---------------------------------------------------------------------------
// COSMETIC (it.failing: passes today)
// ---------------------------------------------------------------------------

describe("display contract", () => {
  it("templates print → like every typed machine (pda for a^n b^n, tm binary increment)", () => {
    // Fixed: the template listing goes through the same printer as the paste-back block.
    for (const s of ["pda for a^n b^n\ntest: ab", "tm binary increment 1011"]) {
      const r = disc(s);
      expect(text(r)).not.toMatch(/->/);
    }
  });
});
