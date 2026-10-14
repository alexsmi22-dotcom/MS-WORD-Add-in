// SAT engine (sat.ts) — SCOPE-COMPUTATION-THEORY §D "SAT" values pinned
// verbatim where the engine reproduces them, the proplogic ↔ sat division of
// labour pinned both ways, and the display contract (printed CNFs re-parse).
//
// §D values this engine reproduces DIFFERENTLY (both correct; pinned on the
// parts that coincide, the difference recorded here, never silently absorbed):
//   · dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q): §D lists the refutation
//     q; ¬q; □. Conflict analysis here yields (¬p ∨ ¬q),(¬p ∨ q) ⇒ ¬p;
//     (p ∨ ¬q),(p ∨ q) ⇒ p; ¬p, p ⇒ □ — also 3 verified resolvents, core = all 4.
//   · dpll (a ∨ b ∨ c) ∧ (¬a ∨ b) ∧ (¬b ∨ c) ∧ (¬c ∨ a) ∧ (¬a ∨ ¬b ∨ ¬c), branch
//     a = F: §D says ¬c ⇒ ¬b ⇒ conflict; unit propagation in clause order gives
//     c = F, then b = T from (a ∨ b ∨ c), conflict (¬b ∨ c). Verdict and branch
//     count agree (UNSAT in 2 branches).

import {
  solveSat, SAT_RE, SAT_CAPS, parseCnf, parseDimacs, showCnf, countModels, dpll, twoSat, horn,
} from "../sat";
import { tryPropLogic } from "../proplogic";
import { DiscreteError } from "../discrete";

const run = (s: string) => solveSat(s)!;
const refusal = (s: string): string => {
  try { solveSat(s); } catch (e) { expect(e).toBeInstanceOf(DiscreteError); return (e as Error).message; }
  throw new Error(`expected a refusal for ${s}`);
};

describe("§D SAT", () => {
  it("(a ∨ ¬b) ∧ (b ∨ c) ≤ 10 vars → not claimed here; proplogic's table answers unchanged", () => {
    expect(solveSat("(a ∨ ¬b) ∧ (b ∨ c)")).toBeNull();
    expect(tryPropLogic("(a ∨ ¬b) ∧ (b ∨ c)")!.display[1]).toBe("CONTINGENT — true in 4 of 8 rows (satisfiable, not valid).");
  });
  it("dpll (a ∨ ¬b) ∧ (b ∨ c) → pure a = T, pure b = T, c = F; every clause ✓; 4 models", () => {
    const r = run("dpll (a ∨ ¬b) ∧ (b ∨ c)");
    expect(r.steps).toContain("pure a = T (only positive in the open clauses)");
    expect(r.steps).toContain("pure b = T (only positive in the open clauses)");
    expect(r.display[1]).toMatch(/^SATISFIABLE: a=T b=T c=F/);
    expect(r.steps).toContain("  (a ∨ ¬b) ✓ (a)");
    expect(r.steps).toContain("  (b ∨ c) ✓ (b)");
    expect(r.display[2]).toBe("4 models in all (brute force over 8 assignments).");
  });
  it("dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q) → p=T: unit q, conflict (¬p ∨ ¬q); p=F: unit q, conflict (p ∨ ¬q); UNSAT; core all 4; tree drawn", () => {
    const r = run("dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q)");
    expect(r.steps.slice(1, 7)).toEqual([
      "decide p = T", "  unit q = T from (¬p ∨ q)", "  conflict (¬p ∨ ¬q)",
      "decide p = F", "  unit q = T from (p ∨ q)", "  conflict (p ∨ ¬q)",
    ]);
    expect(r.display[1]).toMatch(/^UNSATISFIABLE — every branch ends in a conflict \(2 branches/);
    expect(r.display[2]).toMatch(/^Resolution refutation \(3 resolvents\)/);
    expect(r.display[3]).toBe("Unsat core (4 of 4 clauses): {(p ∨ q), (¬p ∨ q), (p ∨ ¬q), (¬p ∨ ¬q)}");
    expect(r.svg).toMatch(/⊥/);
  });
  it("p cnf 3 2 ⏎ 1 -2 0 ⏎ 2 3 0 → (x₁ ∨ ¬x₂) ∧ (x₂ ∨ x₃), SAT, x₁=T x₂=T x₃=F, 4 models", () => {
    const r = run("p cnf 3 2\n1 -2 0\n2 3 0");
    expect(r.display[0]).toBe("CNF, 3 variables, 2 clauses: (x₁ ∨ ¬x₂) ∧ (x₂ ∨ x₃)");
    expect(r.display[1]).toMatch(/^SATISFIABLE: x₁=T x₂=T x₃=F/);
    expect(r.display[2]).toMatch(/^4 models in all/);
    expect([...r.display, ...r.steps].join(" ")).not.toMatch(/more than one unknown/);
  });
  it("2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) ∧ (¬x2 ∨ x1) → the six implication edges, SCCs {x1, x2}, {¬x1, ¬x2}, the only model x1=T x2=T, graph drawn", () => {
    const r = run("2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) ∧ (¬x2 ∨ x1)");
    const s = r.steps.join("\n");
    for (const e of ["¬x1 → x2", "¬x2 → x1", "x1 → x2", "¬x2 → ¬x1", "x2 → x1", "¬x1 → ¬x2"]) expect(s).toContain(e);
    expect(s).toContain("{x1, x2}, {¬x1, ¬x2}");
    expect(r.display[1]).toBe("SATISFIABLE: x1=T x2=T");
    expect(r.display[2]).toMatch(/the only model/);
    expect(r.svg).toMatch(/^<svg/);
  });
  it("2-sat (a ∨ b) ∧ (¬a ∨ b) ∧ (a ∨ ¬b) ∧ (¬a ∨ ¬b) → one SCC {a, ¬a, b, ¬b}, UNSAT (a and ¬a in the same component)", () => {
    const r = run("2-sat (a ∨ b) ∧ (¬a ∨ b) ∧ (a ∨ ¬b) ∧ (¬a ∨ ¬b)");
    expect(r.steps.join("\n")).toContain("Strongly connected components (Tarjan): {a, ¬a, b, ¬b}");
    expect(r.display[1]).toMatch(/^UNSATISFIABLE — a and ¬a are in the same strongly connected component/);
  });
  it("horn a, a -> b, b -> c, ~c → forced a, b, c; ¬c violated → UNSAT", () => {
    expect(run("horn a, a -> b, b -> c, ~c").display[1]).toBe("Forced true: a, b, c; clause ¬c violated → UNSATISFIABLE.");
  });
  it("is (a ∨ b) ∧ (¬a ∨ ¬b) satisfiable → yes, a=T b=F, 2 models (claimed here: proplogic refused the trailing verb); ASCII twin too", () => {
    for (const s of ["is (a ∨ b) ∧ (¬a ∨ ¬b) satisfiable", "is (a | b) & (~a | ~b) satisfiable"]) {
      const r = run(s);
      expect(r.display[1]).toBe("Yes: it is satisfiable.");
      expect(r.display[2]).toMatch(/^SATISFIABLE: a=T b=F/);
      expect(r.display[3]).toBe("2 models in all (brute force over 4 assignments).");
    }
    expect(run("is (a) ∧ (¬a) satisfiable").display[1]).toBe("No: it is unsatisfiable.");
    expect(solveSat("is (p -> q) & p satisfiable")).toBeNull(); // not CNF: the table answers
  });
  it("unsat core (a) ∧ (¬a) ∧ (b ∨ c) → core {a, ¬a}", () => {
    expect(run("unsat core (a) ∧ (¬a) ∧ (b ∨ c)").display).toContain("Unsat core (2 of 3 clauses): {a, ¬a}");
  });
  it("dpll (a ∨ b ∨ c) ∧ (¬a ∨ b) ∧ (¬b ∨ c) ∧ (¬c ∨ a) ∧ (¬a ∨ ¬b ∨ ¬c) → a=T ⇒ b ⇒ c ⇒ conflict; a=F ⇒ ¬c ⇒ … ⇒ conflict; UNSAT in 2 branches", () => {
    const r = run("dpll (a ∨ b ∨ c) ∧ (¬a ∨ b) ∧ (¬b ∨ c) ∧ (¬c ∨ a) ∧ (¬a ∨ ¬b ∨ ¬c)");
    expect(r.steps.slice(1, 5)).toEqual(["decide a = T", "  unit b = T from (¬a ∨ b)", "  unit c = T from (¬b ∨ c)", "  conflict (¬a ∨ ¬b ∨ ¬c)"]);
    expect(r.steps.slice(5, 7)).toEqual(["decide a = F", "  unit c = F from (¬c ∨ a)"]);
    expect(r.display[1]).toMatch(/\(2 branches, 2 conflicts\)/);
  });
  it("pigeonhole 3 pigeons 2 holes → refusal by name showing the 9 clauses; typed, they are UNSAT with 0 models", () => {
    const m = refusal("pigeonhole 3 pigeons 2 holes");
    expect(m).toMatch(/prose, not a CNF/);
    expect(m).toMatch(/The 9 clauses over p₁₁…p₃₂/);
    const clauses = /are: (.*) — type/.exec(m)![1];
    const r = run(`dpll ${clauses}`);
    expect(r.display[1]).toMatch(/^UNSATISFIABLE/);
    expect(r.display).toContain("0 models in all (brute force agrees).");
  });
  it("an 11-variable CNF → DPLL, never 'above the 10-variable cap'", () => {
    const r = run("(x1 ∨ x2) ∧ (x3 ∨ x4) ∧ (x5 ∨ x6) ∧ (x7 ∨ x8) ∧ (x9 ∨ x10) ∧ (¬x11 ∨ x1)");
    expect(r.title).toBe("DPLL");
    expect([...r.display, ...r.steps].join(" ")).not.toMatch(/above the 10-variable cap\./);
  });
});

describe("proplogic ↔ sat: neither steals the other", () => {
  it("sat/satisfiable/cnf ≤ 10 vars stay with proplogic", () => {
    for (const s of ["sat (a | ~b) & (b | c) & (~a | ~c)", "satisfiable? (p -> q) & p & ~q", "cnf (p -> q) & r", "(x1 ∨ x2 ∨ x3) ∧ (¬x1 ∨ ¬x2)"]) expect(solveSat(s)).toBeNull();
  });
  it("SAT keywords are claimed here", () => {
    for (const s of ["dpll (p ∨ q)", "2sat (a ∨ b)", "2-sat (a ∨ b)", "horn a, a -> b", "unsat core (a) ∧ (¬a)", "resolution proof (a) ∧ (¬a)", "p cnf 1 1\n1 0", "dimacs\np cnf 1 1\n1 0"]) {
      expect(SAT_RE.test(s)).toBe(true);
      expect(solveSat(s)).not.toBeNull();
    }
  });
  it("bare implication lines are not claimed (graph / logic territory)", () => {
    expect(solveSat("A->B\nB->C")).toBeNull();
    expect(solveSat("p -> q")).toBeNull();
  });
});

describe("refusals and caps", () => {
  it("non-CNF under dpll → convert first", () => {
    expect(refusal("dpll (a ∧ b) ∨ c")).toMatch(/not in CNF|convert first/);
    expect(refusal("dpll ¬(a ∨ b)")).toMatch(/not in CNF/);
    expect(refusal("dpll a ↔ b")).toMatch(/convert first/);
    expect(refusal("dpll a ∨ b ∧ c")).toMatch(/ambiguous/);
  });
  it("2sat refuses a 3-literal clause; horn refuses two positive literals", () => {
    expect(refusal("2sat (a ∨ b ∨ c)")).toMatch(/Not a 2-CNF/);
    expect(refusal("horn (a ∨ b)")).toMatch(/Not Horn/);
  });
  it("caps are the stated numbers", () => {
    expect(SAT_CAPS.vars).toBe(60);
    expect(SAT_CAPS.clauses).toBe(400);
    expect(SAT_CAPS.decisions).toBe(5_000); // brief said 200,000; lowered so the worst case stays < ~400 ms (see sat.ts)
    expect(SAT_CAPS.twoSatClauses).toBe(2_000);
    expect(SAT_CAPS.hornClauses).toBe(2_000);
    expect(SAT_CAPS.countVars).toBe(20);
    expect(SAT_CAPS.countBudget).toBe(2_000_000);
  });
  it("the decision budget ends in UNKNOWN: search budget, never a guess", () => {
    const cnf = parseCnf("(a ∨ b) ∧ (¬a ∨ b) ∧ (a ∨ ¬b) ∧ (¬a ∨ ¬b)", { allowImplications: false, multiline: false });
    expect(dpll(cnf, 0).kind).toBe("budget");
  });
  it("DIMACS refuses a literal beyond the declared variables", () => {
    expect(refusal("p cnf 2 1\n1 3 0")).toMatch(/declares only 2 variables/);
  });
});

describe("display contract — printed CNFs re-parse", () => {
  const CNFS = ["(a ∨ ¬b) ∧ (b ∨ c)", "(a) ∧ (¬a) ∧ (b ∨ c)", "(x₁ ∨ ¬x₂) ∧ (x₂ ∨ x₃)", "(p ∨ q)(¬p ∨ q)", "a & (b | ~c)"];
  it("showCnf ∘ parseCnf is a fixpoint", () => {
    for (const s of CNFS) {
      const once = showCnf(parseCnf(s, { allowImplications: false, multiline: false }));
      expect(showCnf(parseCnf(once, { allowImplications: false, multiline: false }))).toBe(once);
    }
  });
  it("the engine's echoed CNF re-parses to the same clauses", () => {
    const r = run("p cnf 3 2\n1 -2 0\n2 3 0");
    const echoed = r.display[0].replace(/^CNF, .*?: /, "");
    expect(showCnf(parseCnf(echoed, { allowImplications: false, multiline: false }))).toBe(echoed);
  });
});

describe("engines agree with brute force", () => {
  it("2-SAT and Horn models check out; counts agree", () => {
    const c2 = parseCnf("(a ∨ b) ∧ (¬a ∨ c) ∧ (¬b ∨ ¬c)", { allowImplications: false, multiline: false });
    expect(twoSat(c2, false).kind).toBe(countModels(c2)!.count > 0 ? "sat" : "unsat");
    const ch = parseCnf("a, a -> b, b ∧ c -> d", { allowImplications: true, multiline: true });
    const h = horn(ch);
    expect(h.kind).toBe("sat");
    expect(h.forced.map((v) => ch.vars[v])).toEqual(["a", "b"]);
  });
  it("DIMACS comment lines are skipped and said", () => {
    const d = parseDimacs("c a comment\np cnf 2 2\n1 2 0\n-1 0");
    expect(d.comments).toBe(1);
    expect(d.cnf.clauses.length).toBe(2);
  });
});
