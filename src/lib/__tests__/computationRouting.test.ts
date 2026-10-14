/**
 * Routing through the FRONT DOOR (v2.133.0). Each computation-theory engine
 * was tested directly by its builder; this sends the inputs through
 * `solveDiscrete` with the real ENGINES order and asserts WHICH engine claimed
 * each one — so number theory (which lower-cases and strips parentheses),
 * recurrence (`name(...) = ...`) and combinatorics (`P(10,3)`, the derangement
 * `D4`) cannot steal `δ(q0, 1) = (q1, 0, L)`, `P(x, f(y))` or
 * `unify f(x) with g(x)`, and the new engines cannot steal the old engines'
 * input. The pane's equation→discrete/λ switch is asserted on the source.
 * SCOPE-COMPUTATION-THEORY §E.1, E.5, E.11.
 */
import * as fs from "fs";
import * as path from "path";
import { ENGINES, DiscreteError } from "../discrete";
import { GRAMMAR_RE } from "../grammar";
import { PDA_RE } from "../pda";
import { TM_RE } from "../turing";
import { FOL_RE } from "../fol";
import { SAT_RE } from "../sat";
import { HM_RE, solveLambda } from "../lambda";
import { computationKindFor } from "../ctSwitch";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

/** The first engine in the real order that claims the text (an answer OR a
 *  named refusal — both mean "this engine owns it"). */
function claimedBy(text: string): string {
  for (const e of ENGINES) {
    try {
      if (e.run(text)) return e.name;
    } catch (err) {
      if (err instanceof DiscreteError) return e.name;
      throw err;
    }
  }
  return "none";
}

describe("every computation-theory input reaches its own engine", () => {
  const cases: [string, string][] = [
    ["S -> aSb | ε\ntest: aabb ab aab", "grammar"],
    ["S -> S S | a\nis it ambiguous", "grammar"],
    ["first and follow\nE -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id", "grammar"],
    ["remove left recursion\nE -> E + T | T\nT -> T * F | F\nF -> ( E ) | id", "grammar"],
    ["S -> aSb\nS -> ab", "grammar"],
    ["S -> 0S1 | ε\ntest: 0011", "grammar"],
    ["pda\nstates: q0 q1 q2\nalphabet: a b\nstack: Z A\nstart: q0\naccept: q2\nq0 a Z -> q0 AZ\nq0 a A -> q0 AA\nq0 b A -> q1 ε\nq1 b A -> q1 ε\nq1 ε Z -> q2 Z\ntest: aabb ab", "pushdown"],
    ["cfg to pda S -> aSb | ε\ntest: aabb", "pushdown"],
    ["pda for a^n b^n\ntest: aabb", "pushdown"],
    ["tm binary increment 1011", "turing"],
    ["tm unary add 111+11", "turing"],
    ["tm\nstates: q0 q1 halt\nstart: q0\naccept: halt\nblank: _\nδ(q0, 0) = (q0, 0, R)\nδ(q0, 1) = (q0, 1, R)\nδ(q0, _) = (q1, _, L)\nδ(q1, 1) = (q1, 0, L)\nδ(q1, 0) = (halt, 1, R)\nδ(q1, _) = (halt, 1, R)\ntape: 1011", "turing"],
    ["tm busy beaver 3", "turing"],
    ["prenex ∀x P(x) → ∃y Q(y)", "first-order logic"],
    ["skolemize ∀x ∃y P(x, y)", "first-order logic"],
    ["unify f(x, x) and f(y, g(y))", "first-order logic"],
    ["unify f(x) with g(x)", "first-order logic"],
    ["resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)", "first-order logic"],
    ["∀x ∃y P(x, f(y))", "first-order logic"],
    ["dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q)", "sat"],
    ["2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) ∧ (¬x2 ∨ x1)", "sat"],
    ["horn a, a -> b, b -> c, ~c", "sat"],
    ["p cnf 3 2\n1 -2 0\n2 3 0", "sat"],
  ];
  it.each(cases)("%s → %s", (text, engine) => {
    expect(claimedBy(text)).toBe(engine);
  });
});

describe("the old engines keep their input (still-works twins)", () => {
  const cases: [string, string][] = [
    ["p -> q", "propositional logic"],
    ["(p -> q) & ~q -> ~p", "propositional logic"],
    ["sat (p | q) & (~p | q)", "propositional logic"],
    ["cnf (p -> q) & r", "propositional logic"],
    ["P -> Q | R", "propositional logic"],
    ["A->B\nB->C", "graph"],
    ["A -> B\nB -> C", "graph"],
    ["shortest path A to C\nA-B 1\nB-C 1\nA-C 5", "graph"],
    ["x ≡ 2 mod 3, x ≡ 3 mod 5", "number theory"],
    ["gcd 84 36", "number theory"],
    ["P(10,3)", "combinatorics"],
    ["10 choose 3", "combinatorics"],
    ["a(n) = a(n-1) + a(n-2), a(0) = 0, a(1) = 1", "recurrence"],
    ["regex (a|b)*abb", "automata"],
    ["dfa\nstates: q0 q1\nalphabet: 0 1\nstart: q0\naccept: q1\nq0 0 q1\nq0 1 q0\nq1 0 q1\nq1 1 q0\ntest: 0 1 00", "automata"],
  ];
  it.each(cases)("%s → %s", (text, engine) => {
    expect(claimedBy(text)).toBe(engine);
  });
});

describe("the pane reaches the engines from the default Equation kind", () => {
  it("calls the ONE shared decision function on the RAW input, before the inequality path", () => {
    expect(PANE).toMatch(/import \{ computationKindFor \} from "\.\.\/lib\/ctSwitch";/);
    const sw = PANE.indexOf("const owner = computationKindFor(solveInput.value);");
    const ineq = PANE.indexOf("// An INEQUALITY is unambiguous from its comparison sign.");
    expect(sw).toBeGreaterThan(0);
    expect(ineq).toBeGreaterThan(sw);
  });
  it.each([
    ["S -> aSb | ε\ntest: aabb ab aab", "discrete"],
    ["S -> aSb\nS -> ab", "discrete"],
    ["S -> S S | a\nis it ambiguous", "discrete"],
    ["cfg to pda S -> aSb | ε\ntest: aabb", "discrete"],
    ["pda for a^n b^n\ntest: aabb", "discrete"],
    ["tm binary increment 1011", "discrete"],
    ["does this turing machine halt on every input", "discrete"],
    ["dpll (p ∨ q) ∧ (¬p ∨ q)", "discrete"],
    ["horn a, a -> b, b -> c, ~c", "discrete"],
    ["p cnf 3 2\n1 -2 0\n2 3 0", "discrete"],
    ["unify f(x, g(x)) and f(a, y)", "discrete"],
    ["resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)", "discrete"],
    ["hm let id = λx.x in (id 1, id true)", "lambda"],
    ["hm (λid. id id) (λx.x)", "lambda"],
    ["let id = λx.x in id id", "lambda"],
  ])("the switch TAKES %j → %s", (raw, owner) => {
    expect(computationKindFor(raw)).toBe(owner);
  });
  it.each([
    "x^2 - 4 > 0",
    "maximize 3x + 2y subject to x + y <= 4, x, y >= 0",
    "resolve 6/(x^2 - 1) into partial fractions",
    "a solution exists for x^2 = 4",
    "does the machine do 500 J of work in 10 s",
    "f: x -> x^2",
    "|x - 3| = 5",
    "let x = 5 in the equation 2x + 1",
    "w = 3",
    "S = 4 -> T",
  ])("the switch LEAVES %j in the Equation kind", (raw) => {
    expect(computationKindFor(raw)).toBeNull();
  });
  it("the λ block renders a figure and clears a stale one", () => {
    expect(PANE).toMatch(/if \(lr\.svg\) \{[\s\S]{0,300}currentSolveSvg = lr\.svg;[\s\S]{0,400}\} else \{\s*currentSolveSvg = null;/);
  });
});

describe("equation-kind prose the word-led guards must NOT switch on", () => {
  // These contain FOL guard words (exists, resolve, unify, model) or the
  // machine word; the pane switches only if solveDiscrete ANSWERS, so the
  // engines must not answer them.
  const prose = [
    "a solution exists for x^2 = 4",
    "resolve 6/(x^2 - 1) into partial fractions",
    "does the machine do 500 J of work in 10 s",
    "maximize 3x + 2y subject to x + y <= 4, x, y >= 0",
    "x^2 - 4 > 0",
    "unify the two fractions 1/x + 1/y",
  ];
  it.each(prose)("%s", (text) => {
    const owner = claimedBy(text);
    if (FOL_RE.test(text)) {
      // The pane's condition: a word-led guard switches only on an ANSWER.
      let answered = false;
      try {
        for (const e of ENGINES) {
          const r = e.run(text);
          if (r) { answered = r.title !== "Not recognised"; break; }
        }
      } catch {
        answered = false;
      }
      expect(`${text}: ${answered ? `answered by ${owner}` : "stands aside"}`).toBe(`${text}: stands aside`);
    }
    // Never claimed by a keyword-led computation-theory guard.
    expect(GRAMMAR_RE.test(text) || PDA_RE.test(text) || TM_RE.test(text) || SAT_RE.test(text)).toBe(false);
  });
  it("a halting question about 'the machine' is still the Turing engine's (twin of the physics case)", () => {
    expect(TM_RE.test("does this machine halt on every input")).toBe(true);
    expect(TM_RE.test("does the machine do 500 J of work in 10 s")).toBe(false);
  });
  it("hm switches only on a real Hindley–Milner result", () => {
    for (const text of ["w (λx.x)", "let x = 5", "hm let id = λx.x in (id 1, id true)"]) {
      if (!HM_RE.test(text) && !/^\s*let\s+(?:rec\s+)?[A-Za-z_]\w*\s*=[\s\S]*\bin\s/.test(text)) continue;
      let lr = null;
      try { lr = solveLambda(text); } catch { lr = null; }
      if (text.startsWith("hm ")) expect(lr?.title).toBe("Hindley–Milner type");
    }
  });
});
