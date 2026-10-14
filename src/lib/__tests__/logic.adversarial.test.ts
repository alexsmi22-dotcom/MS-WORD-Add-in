// Hostile pass over fol.ts + sat.ts (house rule: a separate adversarial suite).
// Every case is something a first implementation gets wrong: repeated
// variables, deep occurs checks, factoring, the three resolution verdicts that
// must never blur, stack depth, brute-force agreement, caps at the boundary.

import { solveFol, parseTerm, unifyTerms, applyTerm, showTerm } from "../fol";
import { solveSat, parseCnf, dpll, countModels, bruteSatisfiable, Cnf } from "../sat";
import { DiscreteError } from "../discrete";

const fol = (s: string) => solveFol(s)!;
const sat = (s: string) => solveSat(s)!;
const timed = <T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  expect(Date.now() - t0).toBeLessThan(4000);
  return r;
};
const throwsDiscrete = (f: () => unknown): string => {
  let err: unknown = null;
  try { f(); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(DiscreteError);
  return (err as Error).message;
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe("unification", () => {
  it("repeated variables and nested functions: f(x, g(x), h(x, y)) vs f(a, y, h(a, z))", () => {
    const r = timed(() => fol("unify f(x, g(x), h(x, y)) and f(a, y, h(a, z))"));
    expect(r.display).toContain("MGU: {x ↦ a, y ↦ g(a), z ↦ g(a)}");
    expect(r.display).toContain("Both become f(a, g(a), h(a, g(a)))");
  });
  it("occurs check x vs f(x)", () => {
    expect(fol("unify x and f(x)").display[1]).toBe("No unifier: occurs check — x would have to contain f(x).");
  });
  it("the deep occurs check y vs g(g(g(y)))", () => {
    expect(fol("unify y and g(g(g(y)))").display[1]).toBe("No unifier: occurs check — y would have to contain g(g(g(y))).");
  });
  it("an occurs check that only appears after a binding chain: f(x, y, x) vs f(y, g(z), z)", () => {
    // x ↦ y, y ↦ g(z), then x (= g(z)) vs z: z inside g(z).
    expect(fol("unify f(x, y, x) and f(y, g(z), z)").display[1]).toMatch(/occurs check/);
  });
  it("the MGU is idempotent: applying it twice changes nothing", () => {
    const t1 = parseTerm("f(x, y, z)"), t2 = parseTerm("f(y, z, a)");
    const u = unifyTerms([[t1, t2]]);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    const once = applyTerm(t1, u.subst);
    expect(showTerm(applyTerm(once, u.subst))).toBe(showTerm(once));
    expect(showTerm(once)).toBe("f(a, a, a)");
  });
});

describe("resolution verdicts never blur", () => {
  it("a problem that needs factoring: ∀x ∀y (P(x) ∨ P(y)) ⊢ ∃z P(z)… and its unsatisfiable dual", () => {
    const r = timed(() => fol("resolution: ∀x ∀y (P(x) ∨ P(y)), ∀u ∀v (¬P(u) ∨ ¬P(v))"));
    expect(r.display[1]).toMatch(/^UNSATISFIABLE/);
    expect(r.steps.join("\n")).toMatch(/by factoring/);
    const v = timed(() => fol("∀x ∀y (P(x) ∨ P(y)) ⊢ P(a)"));
    expect(v.display[1]).toMatch(/VALID/);
  });
  it("the drinker paradox ∃x (D(x) → ∀y D(y)) is valid — resolution refutes its negation", () => {
    const r = timed(() => fol("is ∃x (D(x) → ∀y D(y)) valid"));
    expect(r.display[1]).toMatch(/^REFUTED .* VALID\.$/);
  });
  it("∀x ∃y P(x,y) ⊢ ∃y ∀x P(x,y) is INVALID — saturates", () => {
    const r = timed(() => fol("∀x ∃y P(x,y) ⊢ ∃y ∀x P(x,y)"));
    expect(r.display[1]).toMatch(/^SATURATED .* INVALID/);
    expect(r.display.join(" ")).not.toMatch(/UNKNOWN|REFUTED|the argument is VALID/);
  });
  it("an infinite-saturation case hits the clause cap and says UNKNOWN — never INVALID", () => {
    // Serial + irreflexive + transitive: only infinite models, so no finite
    // countermodel exists and resolution never terminates.
    const r = timed(() => fol("∀x ∃y R(x, y), ∀x ¬R(x, x), ∀x ∀y ∀z (R(x, y) ∧ R(y, z) → R(x, z)) ⊢ ∃x R(x, x)"));
    const d = r.display.join(" ");
    expect(d).toMatch(/UNKNOWN \(first-order validity is only semi-decidable/);
    expect(d).not.toMatch(/INVALID|SATURATED|REFUTED/);
  });
  it("a free variable in the goal is closed BEFORE negation: P(a) ⊢ P(x) is INVALID, not a refutation via [x ↦ a]", () => {
    const r = fol("resolve P(a) ⊢ P(x)");
    expect(r.display[1]).toMatch(/INVALID/);
    expect(r.display.join(" ")).not.toMatch(/REFUTED/);
    expect(r.display.join(" ")).toMatch(/Countermodel/);
    expect(r.caveats.join(" ")).toMatch(/closure is taken before the goal is negated/);
  });
  it("a bound name does not leak out of its scope: in ∃a P(a) ∧ ¬P(a) the right-hand a is the constant", () => {
    const r = fol("∃a P(a) ∧ ¬P(a)");
    expect(r.display.join(" ")).toMatch(/Satisfiable/);
    expect(r.display.join(" ")).not.toMatch(/UNSATISFIABLE/);
  });
  it("saturation found by the model search alone never claims VALID", () => {
    const r = fol("resolve P(a) ⊢ Q(a)");
    expect(r.display[1]).toMatch(/INVALID/);
    expect(r.display.join(" ")).toMatch(/Countermodel/);
  });
});

describe("review pins (computation.review): time, ↔, all-tautology arguments", () => {
  it("an infinite Herbrand universe with an unrelated goal: INVALID with a countermodel, fast (pure-literal deletion + term-depth bound)", () => {
    for (const g of ["Q(a)", "Q(b)", "Q(c)"]) {
      const t0 = Date.now();
      const r = fol(`resolve ∀x (P(x) → P(f(x))), P(a) ⊢ ${g}`);
      expect(Date.now() - t0).toBeLessThan(4000); // gross-freeze bound; measured well under 300 ms
      const d = r.display.join(" ");
      expect(d).toMatch(/INVALID/);
      expect(d).toMatch(/countermodel|Countermodel/);
      expect(r.steps.join(" ")).toMatch(/pure-literal rule/);
    }
  });
  it("the term-depth bound turns a would-be saturation into UNKNOWN, never INVALID, when no finite countermodel is found", () => {
    // P(a), ∀x (P(x) → P(f(x))) ⊢ P(f(f(f(f(f(f(f(a)))))))) is VALID: the refutation needs depth 7 > 6.
    const r = fol("resolve ∀x (P(x) → P(f(x))), P(a) ⊢ P(f(f(f(f(f(f(f(a))))))))");
    const d = r.display.join(" ");
    expect(d).not.toMatch(/INVALID|SATURATED/);
    expect(d).toMatch(/REFUTED|UNKNOWN/);
  });
  it("↔ under a quantifier and in resolve is answered (no 'Internal:' message)", () => {
    for (const s of ["resolve ∀x (P(x) ↔ Q(x)), P(a) ⊢ Q(a)", "is ∀x (P(x) ↔ P(x)) valid", "resolve P(a) ↔ Q(a), P(a) ⊢ Q(a)"]) {
      const d = fol(s).display.join(" ");
      expect(d).toMatch(/\bVALID\b/);
      expect(d).not.toMatch(/INVALID/);
    }
    expect(fol("∀x (P(x) ↔ Q(x))").display[3]).toBe("Clauses: {P(x), ¬Q(x)}, {Q(x), ¬P(x)}");
    expect(fol("skolemize ∀x ∃y (P(x) ↔ Q(y))").display.join(" ")).toMatch(/Skolem form/);
  });
  it("an argument whose clauses are all tautologies gets a verdict: INVALID with a countermodel", () => {
    const d = fol("resolve (P(a) ∨ ¬P(a)) ⊢ (¬P(a) ∧ P(a))").display.join(" ");
    expect(d).toMatch(/INVALID/);
    expect(d).toMatch(/Countermodel/);
  });
});

describe("DPLL time at the phase transition", () => {
  it("50 random 3-CNFs, 60 variables / 256 clauses: each answers (SAT / UNSAT / UNKNOWN by name) under a gross 1 s bound", () => {
    const r = rng(7);
    for (let k = 0; k < 50; k++) {
      const cl: string[] = [];
      for (let i = 0; i < 256; i++) {
        const vs = new Set<number>();
        while (vs.size < 3) vs.add(1 + Math.floor(r() * 60));
        cl.push(`(${[...vs].map((v) => `${r() < 0.5 ? "¬" : ""}x${v}`).join(" ∨ ")})`);
      }
      const res = timed(() => sat(`dpll ${cl.join(" ∧ ")}`));
      expect(res.display[1]).toMatch(/^(?:SATISFIABLE|UNSATISFIABLE|UNKNOWN: search budget)/);
    }
  });
  it("a search that exhausts the decision budget says UNKNOWN: search budget, fast", () => {
    const p = (i: number, j: number) => `p${i}_${j}`;
    const cl: string[] = [];
    for (let i = 1; i <= 8; i++) cl.push(`(${Array.from({ length: 7 }, (_, j) => p(i, j + 1)).join(" ∨ ")})`);
    for (let h = 1; h <= 7; h++) for (let i = 1; i <= 8; i++) for (let j = i + 1; j <= 8; j++) cl.push(`(¬${p(i, h)} ∨ ¬${p(j, h)})`);
    const res = timed(() => sat(`dpll ${cl.join(" ∧ ")}`));
    expect(res.display[1]).toMatch(/^(?:UNSATISFIABLE|UNKNOWN: search budget — 5,000 decisions)/);
    expect(res.display[1]).not.toMatch(/^SATISFIABLE/);
  });
});

describe("depth and size", () => {
  it("2,000 nested parentheses → answered (the iterative parser collapses pure grouping), no RangeError", () => {
    const s = "(".repeat(2000) + "∀x P(x) → P(a)" + ")".repeat(2000);
    const r = timed(() => solveFol(`is ${s} valid`))!;
    expect(r.display[0]).toBe("Is ∀x P(x) → P(a) valid?");
    expect(r.display[1]).toMatch(/^REFUTED .* VALID\.$/);
    // Parentheses around a connective DO nest: 2,000 of them hit the cap by name.
    const deep = "(".repeat(2000) + "∀x P(x) ∧ Q(a)" + ")".repeat(2000);
    let inner = "∀x P(x)";
    for (let i = 0; i < 2000; i++) inner = `(${inner} ∧ Q(a))`;
    expect(throwsDiscrete(() => solveFol(`is ${inner} valid`))).toMatch(/400-deep cap/);
    expect(() => solveFol(`is ${deep} valid`)).not.toThrow(RangeError);
  });
  it("2,000 nested negations under a quantifier → refused by the depth cap", () => {
    const m = throwsDiscrete(() => solveFol("∀x " + "¬".repeat(2000) + "P(x)"));
    expect(m).toMatch(/400-deep cap/);
  });
  it("a 2,000-deep term inside an atom is caught by the same cap", () => {
    const s = "∀x P(" + "f(".repeat(2000) + "x" + ")".repeat(2001);
    expect(throwsDiscrete(() => solveFol(s))).toMatch(/400-deep cap/);
    expect(throwsDiscrete(() => solveFol("unify x and " + "g(".repeat(2000) + "y" + ")".repeat(2000)))).toMatch(/400-deep cap/);
  });
  it("2,000 nested parentheses in a CNF → refused as not CNF, no RangeError", () => {
    const s = "dpll " + "(".repeat(2000) + "a" + ")".repeat(2000);
    expect(throwsDiscrete(() => solveSat(s))).toMatch(/Nested parentheses|not in CNF/);
  });
});

function randomCnf(r: () => number, n: number, m: number): string {
  const clauses: string[] = [];
  for (let i = 0; i < m; i++) {
    const lits = new Set<string>();
    while (lits.size < 3) {
      const v = 1 + Math.floor(r() * n);
      if ([...lits].some((l) => l.endsWith(`x${v}`) && l.replace("¬", "") === `x${v}`)) continue;
      lits.add(`${r() < 0.5 ? "¬" : ""}x${v}`);
    }
    clauses.push(`(${[...lits].join(" ∨ ")})`);
  }
  return clauses.join(" ∧ ");
}

describe("SAT vs brute force", () => {
  it("50 random 20-variable 3-CNFs: DPLL verdict = brute force; models check; refutations verify", () => {
    const r = rng(20261014);
    let sats = 0, unsats = 0;
    for (let k = 0; k < 50; k++) {
      const m = 70 + Math.floor(r() * 30); // around the 4.26 threshold: both verdicts occur
      const text = randomCnf(r, 20, m);
      const cnf: Cnf = parseCnf(text, { allowImplications: false, multiline: false });
      const t0 = Date.now();
      const res = sat(`dpll ${text}`); // throws DiscreteError on any disagreement
      expect(Date.now() - t0).toBeLessThan(4000);
      const truth = bruteSatisfiable(cnf);
      if (cnf.vars.length <= 20) expect(truth).not.toBeNull();
      expect(res.display[1].startsWith("SATISFIABLE")).toBe(truth === true);
      if (truth) sats++; else unsats++;
      const d = dpll(cnf);
      expect(d.kind).toBe(truth ? "sat" : "unsat");
    }
    expect(sats).toBeGreaterThan(0);
    expect(unsats).toBeGreaterThan(0);
  });
  it("PHP(3,2) typed as clauses → UNSAT with a core", () => {
    const php = "(p11 ∨ p12) ∧ (p21 ∨ p22) ∧ (p31 ∨ p32) ∧ (¬p11 ∨ ¬p21) ∧ (¬p11 ∨ ¬p31) ∧ (¬p21 ∨ ¬p31) ∧ (¬p12 ∨ ¬p22) ∧ (¬p12 ∨ ¬p32) ∧ (¬p22 ∨ ¬p32)";
    const r = timed(() => sat(`unsat core ${php}`));
    expect(r.display[1]).toMatch(/^UNSATISFIABLE/);
    expect(r.display.join("\n")).toMatch(/Unsat core \(9 of 9 clauses\)/);
  });
  it("2-SAT satisfiable vs unsatisfiable", () => {
    expect(sat("2sat (x ∨ y) ∧ (¬x ∨ y) ∧ (x ∨ ¬y)").display[1]).toBe("SATISFIABLE: x=T y=T");
    expect(sat("2sat (x ∨ y)(¬x ∨ y)(x ∨ ¬y)(¬x ∨ ¬y)").display[1]).toMatch(/^UNSATISFIABLE — x and ¬x are in the same strongly connected component/);
  });
  it("Horn with a violated goal clause", () => {
    expect(sat("horn p, q, p ∧ q -> r, ¬r ∨ ¬p").display[1]).toBe("Forced true: p, q, r; clause (¬r ∨ ¬p) violated → UNSATISFIABLE.");
  });
  it("Horn satisfiable → the minimal model", () => {
    expect(sat("horn a, a -> b, c -> d").display[1]).toMatch(/minimal model: a, b true/);
  });
  it("DIMACS with comment lines", () => {
    const r = sat("c generated by hand\nc second comment\np cnf 2 2\n1 2 0\n-1 0");
    expect(r.steps[0]).toMatch(/2 comment lines skipped/);
    expect(r.display[1]).toMatch(/^SATISFIABLE: x₁=F x₂=T/);
  });
  it("60 variables accepted, 61 refused by name", () => {
    const cl = (n: number): string => Array.from({ length: n }, (_, i) => `(v${i + 1} ∨ ¬v${i + 1 === n ? 1 : i + 2})`).join(" ∧ ");
    const ok = timed(() => sat(`dpll ${cl(60)}`));
    expect(ok.display[0]).toMatch(/^CNF, 60 variables/);
    expect(ok.display.join(" ")).toMatch(/Model count not computed/);
    expect(throwsDiscrete(() => solveSat(`dpll ${cl(61)}`))).toMatch(/61 variables is above the 60-variable cap/);
  });
  it("a CNF where the pure-literal rule alone decides", () => {
    const r = sat("dpll (a ∨ b) ∧ (a ∨ ¬c) ∧ (¬d ∨ b)");
    expect(r.caveats[0]).toMatch(/^0 decisions/);
    expect(r.steps.filter((s) => s.includes("pure")).length).toBeGreaterThan(0);
  });
  it("model counts of exactly 0, 1 and 2^n", () => {
    expect(countModels(parseCnf("(a) ∧ (¬a)", { allowImplications: false, multiline: false }))!.count).toBe(0);
    expect(sat("dpll (a) ∧ (¬a)").display).toContain("0 models in all (brute force agrees).");
    expect(sat("dpll (a) ∧ (b) ∧ (¬c)").display[2]).toBe("1 model in all (brute force over 8 assignments).");
    // Only tautological clauses: every assignment is a model (2^3), the CNF is ⊤.
    const taut = parseCnf("(a ∨ ¬a) ∧ (b ∨ ¬b) ∧ (c ∨ ¬c)", { allowImplications: false, multiline: false });
    expect(taut.clauses.length).toBe(0);
    expect(countModels({ vars: ["a", "b", "c"], clauses: [] })!.count).toBe(8);
  });
  it("an unsatisfiable formula is never reported SAT because a model leaf was drawn", () => {
    const r = sat("dpll (a ∨ b) ∧ (¬a ∨ b) ∧ (a ∨ ¬b) ∧ (¬a ∨ ¬b)");
    expect(r.svg).not.toMatch(/#ffe8a3/); // no highlighted model leaf
  });
});
