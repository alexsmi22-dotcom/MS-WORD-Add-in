// First-order logic engine (fol.ts) — SCOPE-COMPUTATION-THEORY §D "First-order
// logic" values pinned verbatim, plus the display contract (every printed
// formula and clause re-parses) and the routing guard.
//
// Oracles: the §D values were computed by an independent Robinson unifier and
// by hand; the resolution derivations here are the textbook ones.

import {
  solveFol, FOL_RE, parseFol, parseTerm, showFormula, showTerm, showClause, unifyTerms, applyTerm,
  freeVars, boundVars, toPrenex, prenexToFormula, clausalForm, skolemNaming, resolution, verifyStep,
  FOL_CAPS, Clause,
} from "../fol";
import { DiscreteError } from "../discrete";

const run = (s: string) => solveFol(s)!;
const all = (s: string) => { const r = run(s); return [...r.display, ...r.steps, ...r.caveats].join("\n"); };
const refusal = (s: string): string => {
  try { solveFol(s); } catch (e) { expect(e).toBeInstanceOf(DiscreteError); return (e as Error).message; }
  throw new Error(`expected a refusal for ${s}`);
};

describe("§D first-order logic", () => {
  it("∀x (P(x) → Q(x)) → echoed, closed, prenex already, clauses {¬P(x), Q(x)}", () => {
    const r = run("∀x (P(x) → Q(x))");
    expect(r.display[0]).toBe("∀x (P(x) → Q(x))");
    expect(r.display[1]).toMatch(/^Closed \(no free variables\)/);
    expect(r.display[2]).toBe("Prenex: already in prenex form.");
    expect(r.display[3]).toBe("Clauses: {¬P(x), Q(x)}");
  });
  it("forall x. P(x) -> exists y. Q(x, y) → ∀x (P(x) → ∃y Q(x, y))", () => {
    expect(run("forall x. P(x) -> exists y. Q(x, y)").display[0]).toBe("∀x (P(x) → ∃y Q(x, y))");
  });
  it("free variables of ∀x P(x, y) ∧ Q(z) → free {y, z}, bound {x}", () => {
    const r = run("free variables of ∀x P(x, y) ∧ Q(z)");
    expect(r.display).toContain("Free: {y, z}");
    expect(r.display).toContain("Bound: {x}");
  });
  it("prenex ∀x P(x) → ∃y Q(y) → ∃x ∃y (P(x) → Q(y)), the flip step named", () => {
    const r = run("prenex ∀x P(x) → ∃y Q(y)");
    expect(r.display).toContain("Prenex: ∃x ∃y (P(x) → Q(y))");
    expect(r.steps.join("\n")).toMatch(/antecedent flips: ∀ becomes ∃/);
  });
  it("skolemize ∀x ∃y P(x, y) → ∀x P(x, f₁(x))", () => {
    const r = run("skolemize ∀x ∃y P(x, y)");
    expect(r.display).toContain("Skolem form: ∀x P(x, f₁(x))");
    expect(r.steps.join("\n")).toMatch(/Skolem function of x/);
  });
  it("clausal form ∀x (P(x) → ∃y Q(x, y)) → {¬P(x), Q(x, f₁(x))}", () => {
    expect(run("clausal form ∀x (P(x) → ∃y Q(x, y))").display[1]).toBe("Clauses: {¬P(x), Q(x, f₁(x))}");
  });
  it("unify P(x, f(y)) and P(a, f(b)) → {x ↦ a, y ↦ b}, both → P(a, f(b))", () => {
    const r = run("unify P(x, f(y)) and P(a, f(b))");
    expect(r.display).toContain("MGU: {x ↦ a, y ↦ b}");
    expect(r.display).toContain("Both become P(a, f(b))");
  });
  it("unify f(x, x) and f(y, g(y)) → occurs check, y would have to contain g(y)", () => {
    expect(run("unify f(x, x) and f(y, g(y))").display[1]).toBe("No unifier: occurs check — y would have to contain g(y).");
  });
  it("mgu of P(x, g(x)), P(f(y), z) → {x ↦ f(y), z ↦ g(f(y))}, both → P(f(y), g(f(y)))", () => {
    const r = run("mgu of P(x, g(x)), P(f(y), z)");
    expect(r.display).toContain("MGU: {x ↦ f(y), z ↦ g(f(y))}");
    expect(r.display).toContain("Both become P(f(y), g(f(y)))");
  });
  it("unify f(x) with g(x) → clash: f ≠ g, never a λ normal form", () => {
    const r = run("unify f(x) with g(x)");
    expect(r.display[1]).toMatch(/clash: f ≠ g/);
    expect(all("unify f(x) with g(x)")).not.toMatch(/Normal form/);
  });
  it("resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a) → clauses 1–3, 4 {Q(a)} from 1, 2 [x ↦ a], 5 □ from 3, 4; VALID; DAG drawn", () => {
    const r = run("resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)");
    const s = r.steps.join("\n");
    expect(s).toMatch(/1\. \{¬P\(x\), Q\(x\)\}/);
    expect(s).toMatch(/2\. \{P\(a\)\}/);
    expect(s).toMatch(/3\. \{¬Q\(a\)\}  \(negated goal\)/);
    expect(s).toMatch(/4\. \{Q\(a\)\} from 1, 2 \[x ↦ a\]/);
    expect(s).toMatch(/5\. □ from 3, 4/);
    expect(r.display[1]).toBe("REFUTED in 2 resolvents — the argument is VALID.");
    expect(r.svg).toMatch(/^<svg/);
  });
  it("resolution: P(a), ∀x (P(x) → Q(x)), ¬Q(a) → UNSATISFIABLE with the same derivation", () => {
    const r = run("resolution: P(a), ∀x (P(x) → Q(x)), ¬Q(a)");
    expect(r.display[1]).toMatch(/^UNSATISFIABLE/);
    expect(r.display[2]).toBe("4. {Q(a)} from 1, 2 [x ↦ a] · 5. □ from 3, 4");
  });
  it("is ∀x P(x) → P(a) valid → VALID, 1 resolvent {P(x)}, {¬P(a)} → □ [x ↦ a]", () => {
    const r = run("is ∀x P(x) → P(a) valid");
    expect(r.display[1]).toBe("REFUTED in 1 resolvent — the formula is VALID.");
    expect(r.steps).toContain("  1. {P(x)}  (negated goal)");
    expect(r.steps).toContain("  2. {¬P(a)}  (negated goal)");
    expect(r.steps).toContain("  3. □ from 1, 2 [x ↦ a]");
  });
  it("∀x ∃y P(x, y) ⊢ ∃y ∀x P(x, y) → {P(x, f₁(x))}, {¬P(g₁(y), y)}; SATURATED, occurs check, INVALID; countermodel {1, 2}, P = {(1, 2), (2, 1)}", () => {
    const r = run("∀x ∃y P(x, y) ⊢ ∃y ∀x P(x, y)");
    expect(r.steps).toContain("  1. {P(x, f₁(x))}  (premise)");
    expect(r.steps).toContain("  2. {¬P(g₁(y), y)}  (negated goal)");
    expect(r.display[1]).toMatch(/^SATURATED .* INVALID/);
    expect(r.display[2]).toMatch(/occurs check — y would have to contain f₁\(g₁\(y\)\)/);
    expect(r.display[3]).toBe("Countermodel: domain {1, 2}, P = {(1, 2), (2, 1)} — every premise true, the goal false.");
  });
  it("∃x ∀y (P(x) ∧ ¬P(y)) → unsatisfiable: {P(c₁)}, {¬P(y)} → □ [y ↦ c₁]", () => {
    expect(run("∃x ∀y (P(x) ∧ ¬P(y))").display).toContain("UNSATISFIABLE (resolution): {P(c₁)}, {¬P(y)} → □ [y ↦ c₁]");
  });
  it("check ∀x ∃y R(x, y) in domain {1, 2}, R = {(1, 2), (2, 1)} → TRUE (x=1: y=2; x=2: y=1)", () => {
    const r = run("check ∀x ∃y R(x, y) in domain {1, 2}, R = {(1, 2), (2, 1)}");
    expect(r.display[1]).toMatch(/^TRUE/);
    expect(r.display[2]).toBe("Why: x = 1: y = 2; x = 2: y = 1");
  });
  it("check ∃y ∀x R(x, y) in … → FALSE (y = 1 fails at x = 1; y = 2 fails at x = 2)", () => {
    const r = run("check ∃y ∀x R(x, y) in domain {1, 2}, R = {(1, 2), (2, 1)}");
    expect(r.display[1]).toMatch(/^FALSE/);
    expect(r.display[2]).toBe("Why not: y = 1 fails at x = 1; y = 2 fails at x = 2");
  });
  it("∀x (x > 0 → x^2 > 0) → refusal by name (arithmetic), never the inequality text", () => {
    const m = refusal("∀x (x > 0 → x^2 > 0)");
    expect(m).toMatch(/first-order logic without arithmetic/);
    expect(m).not.toMatch(/POLYNOMIAL|RATIONAL/);
  });
});

describe("refusals by name", () => {
  it("equality: no paramodulation", () => {
    expect(refusal("∀x (x = x)")).toMatch(/Equality .* no paramodulation/);
  });
  it("second-order quantification", () => {
    expect(refusal("∀P (P(a) → P(a))")).toMatch(/second-order/);
  });
  it("infinite domains for check", () => {
    expect(refusal("check ∀x P(x) in domain ℕ, P = {1}")).toMatch(/infinite|domain/i);
  });
  it("domain above the cap of 6", () => {
    expect(refusal("check ∀x P(x) in domain {1, 2, 3, 4, 5, 6, 7}, P = {1}")).toMatch(/cap is 6/);
  });
  it("uninterpreted predicate in a model check", () => {
    expect(refusal("check ∀x Q(x) in domain {1, 2}, P = {1}")).toMatch(/Q is not interpreted/);
  });
});

describe("unification", () => {
  it("every unifier makes both terms equal (verification is printed)", () => {
    const pairs: [string, string][] = [["f(x, g(y))", "f(h(z), g(a))"], ["P(x, x)", "P(a, y)"], ["g(x, f(x))", "g(f(y), z)"]];
    for (const [a, b] of pairs) {
      const t1 = parseTerm(a), t2 = parseTerm(b);
      const u = unifyTerms([[t1, t2]]);
      expect(u.ok).toBe(true);
      if (u.ok) expect(showTerm(applyTerm(t1, u.subst))).toBe(showTerm(applyTerm(t2, u.subst)));
      expect(run(`unify ${a} and ${b}`).steps.join("\n")).toMatch(/— equal\./);
    }
  });
  it("arity mismatch is named", () => {
    expect(run("unify f(x) and f(a, b)").display[1]).toMatch(/arity: f takes 1 argument on one side and 2 on the other \(1 ≠ 2\)/);
  });
  it("a var line overrides the u–z convention", () => {
    const r = run("var a\nunify f(a) and f(b)");
    expect(r.display).toContain("MGU: {a ↦ b}");
  });
});

describe("normal forms", () => {
  it("free/bound walkers", () => {
    const f = parseFol("∀x (P(x) ∧ ∃y R(x, y, z))");
    expect(freeVars(f)).toEqual(["z"]);
    expect(boundVars(f)).toEqual(["x", "y"]);
  });
  it("rectification renames a reused bound variable and says so", () => {
    const tr = { steps: [] as string[] };
    const p = toPrenex(parseFol("∀x P(x) ∧ ∃x Q(x)"), tr);
    expect(showFormula(prenexToFormula(p))).toBe("∀x ∃x₁ (P(x) ∧ Q(x₁))");
    expect(tr.steps.join("\n")).toMatch(/Rename the bound variable x to x₁/);
  });
  it("↔ with quantifiers is expanded before prenexing (said)", () => {
    const r = run("prenex (∀x P(x)) ↔ Q(a)");
    expect(r.steps.join("\n")).toMatch(/↔ expanded/);
  });
  it("Skolem constants c₁ when no ∀ governs", () => {
    const c = clausalForm(parseFol("∃x ∃y R(x, y)"), skolemNaming("f", new Set()));
    expect(c.clauses.map(showClause)).toEqual(["{R(c₁, c₂)}"]);
  });
  it("Skolem functions of two governing variables", () => {
    expect(run("skolemize ∀x ∀y ∃z R(x, y, z)").display).toContain("Skolem form: ∀x ∀y R(x, y, f₁(x, y))");
  });
});

describe("display contract — printed formulas and clauses re-parse", () => {
  const FORMS = [
    "∀x (P(x) → Q(x))", "forall x. P(x) -> exists y. Q(x, y)", "∀x P(x) → ∃y Q(y)", "¬∀x ∃y (R(x, y) ∨ ¬S(y))",
    "(P(a) → Q(b)) → R(c)", "P(a) → Q(b) → R(c)", "∀x ∀y (P(x) ↔ Q(y))", "∃x (D(x) → ∀y D(y))", "P(\"Socrates\")",
    "¬¬P(a)", "∀x P(f₁(x), x′)",
  ];
  it("showFormula ∘ parseFol is a fixpoint", () => {
    for (const s of FORMS) {
      const once = showFormula(parseFol(s));
      expect(showFormula(parseFol(once))).toBe(once);
    }
  });
  it("printed clauses re-parse as the disjunction of their literals", () => {
    const c = clausalForm(parseFol("∀x (P(x) → ∃y Q(x, y))"), skolemNaming("f", new Set()));
    for (const cl of c.clauses) {
      const back = parseFol(showClause(cl));
      expect(showFormula(back)).toBe("¬P(x) ∨ Q(x, f₁(x))");
    }
    expect(showFormula(parseFol("□"))).toBe("⊥");
  });
  it("every displayed formula line of the engine re-parses", () => {
    for (const s of ["∀x (P(x) → Q(x))", "prenex ∀x P(x) → ∃y Q(y)", "skolemize ∀x ∃y P(x, y)"]) {
      const r = run(s);
      for (const line of r.display) {
        const m = /^(?:Prenex|Skolem form): (.*)$/.exec(line);
        if (m && !/^already/.test(m[1])) expect(() => parseFol(m[1])).not.toThrow();
      }
      expect(() => parseFol(r.display[0])).not.toThrow();
    }
  });
});

describe("resolution core", () => {
  it("every resolvent re-verifies from its printed substitution", () => {
    const parse = (s: string): Clause => clausalForm(parseFol(s), skolemNaming("f", new Set())).clauses[0];
    const r = resolution([{ clause: parse("¬P(x) ∨ Q(x)") }, { clause: parse("P(a)") }, { clause: parse("¬Q(a)") }]);
    expect(r.kind).toBe("refuted");
    for (const d of r.all) expect(verifyStep(d).ok).toBe(true);
  });
  it("caps are the stated numbers", () => {
    expect(FOL_CAPS.clauses).toBe(500);
    expect(FOL_CAPS.unifications).toBe(20_000);
    expect(FOL_CAPS.domain).toBe(6);
    expect(FOL_CAPS.cells).toBe(46_656);
    expect(FOL_CAPS.depth).toBe(400);
  });
});

describe("routing guard", () => {
  it("FOL_RE claims quantifiers and FOL verbs", () => {
    for (const s of ["∀x P(x)", "forall x. P(x)", "unify f(x) with g(x)", "mgu of a, b", "skolemize ∀x ∃y P(x, y)", "resolve P(a) ⊢ P(a)", "check P(a) in domain {1}"]) expect(FOL_RE.test(s)).toBe(true);
  });
  it("a quantifier-free line without a FOL verb stays propositional", () => {
    for (const s of ["p -> q", "(p & q) | r", "sat (a | ~b) & (b | c)", "dpll (p ∨ q)"]) {
      expect(FOL_RE.test(s)).toBe(false);
      expect(solveFol(s)).toBeNull();
    }
  });
  it("resolution proof … belongs to the SAT engine", () => {
    expect(solveFol("resolution proof (a) ∧ (¬a)")).toBeNull();
  });
});
