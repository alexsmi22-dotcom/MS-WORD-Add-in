// Pins from the independent adversarial pass over v2.125.0 (lazy δ-steps,
// normalisation by evaluation, Hamiltonian certificates). Expected values
// are by hand or by the eager reducer.

import { solveLambda, expandedTerm, reduce, alphaEquivalent, parseTerm } from "../lambda";
import { tryGraph, hamiltonian, parseGraph } from "../graphs";

const nf = (s: string) => solveLambda(s)!;

describe("fresh names versus names a definition brings later", () => {
  it("1. a β-invented binder never captures a free variable of a later δ-expansion", () => {
    const r = nf("let FOO = x₁\n(λy.λx.y FOO) x");
    expect(r.normalForm).toBe("λx₂.x x₁");
    expect(r.display.join(" ")).toMatch(/Free variables: x, x₁|Free variables: x₁, x/);
    expect(r.caveats.join(" ")).not.toMatch(/FAILED/);
    const s = nf("let x₁ = 5\nlet FOO = x₁\n(λy.λx.y FOO) x");
    expect(alphaEquivalent(parseTerm(s.normalForm!), parseTerm("λz.x (λf.λx.f (f (f (f (f x)))))"))).toBe(true);
    expect(s.caveats.join(" ")).not.toMatch(/FAILED/);
  });
  it("2. the NbE read-back never captures a definition's free variable under a closure parameter", () => {
    const r = nf("let BB = λx.q\n(λz.λq.z) BB");
    expect(r.normalForm).toBe("λq₁.λx.q");
    expect(r.caveats.join(" ")).not.toMatch(/FAILED/);
    expect(r.steps.join(" ")).toMatch(/Verified: normalisation by evaluation/);
    const s = nf("let BB = λx.q\nlet rec FACT = λn.IF (ISZERO n) 1 (MULT n (FACT (PRED n)))\nPAIR ((λz.λq.z) BB) (FACT 6)");
    expect(s.normalForm!.startsWith("λf.f (λq₁.λx.q)")).toBe(true);
    expect(s.display.join(" ")).toMatch(/Free variable: q/);
  });
  it("3. a forward reference is honoured consistently: expanded, noted truthfully, typed as displayed", () => {
    const r = nf("let AA = λx.BB\nlet BB = λy.x\nAA");
    expect(r.normalForm).toBe("λx₁.λy.x");
    expect(r.display.join(" ")).toMatch(/Free variable: x/);
    expect(r.caveats.join(" ")).not.toMatch(/AA has free variable BB/);
    expect(r.display.join(" ")).toMatch(/Simple type of the term as written: α → β → γ/);
    const s = nf("let AA = BB\nlet CC = λq.AA\nlet BB = λx.q\nCC");
    expect(s.normalForm).toBe("λq₁.λx.q");
  });
  it("4. mutual recursion through two let recs reduces, and the type line says why it is not typed", () => {
    const even = "let rec EVEN = λn.IF (ISZERO n) TRUE (ODD (PRED n))\nlet rec ODD = λn.IF (ISZERO n) FALSE (EVEN (PRED n))";
    expect(nf(`${even}\nEVEN 4`).decoded?.boolean).toBe(true);
    expect(nf(`${even}\nODD 3`).decoded?.boolean).toBe(true);
    expect(nf(`${even}\nEVEN 3`).decoded?.boolean).toBe(false);
    expect(nf(`${even}\nEVEN 4`).display.join(" ")).toMatch(/Simple type: not computed — the definitions refer to each other in a cycle/);
    expect(() => nf(`${even}\nfree EVEN`)).toThrow(/refer to each other in a cycle/);
    // Sixty-three chained lets are not a cycle and still expand.
    const chain = Array.from({ length: 63 }, (_, i) => `let A${i + 1} = SUCC A${i}`).join("\n");
    expect(nf(`let A0 = 0\n${chain}\nA63`).decoded?.numeral).toBe(63);
  });
  it("5. the readout line names the cap that actually fired", () => {
    const r = nf("POW 2 11"); // 2,048: 4,099 nodes but 2,050 deep
    expect(r.decoded?.numeral).toBe(2048);
    expect(r.display.join(" ")).toMatch(/2,050 deep\) is above the 1,500-deep print cap/);
    const s = nf("2 2 2 2"); // 65,536: a numeral is as deep as it is long, so the depth cap fires first
    expect(s.display.join(" ")).toMatch(/131,075 nodes, 65,538 deep\) is above the 1,500-deep print cap/);
  });
  it("6. the NbE rescue line does not repeat the step count", () => {
    const r = nf("let rec FIB = λn.IF (LEQ n 1) n (PLUS (FIB (PRED n)) (FIB (SUB n 2)))\nFIB 10");
    expect(r.decoded?.numeral).toBe(55);
    const line = r.display.find((d) => d.startsWith("Found by normalisation"))!;
    expect(line.match(/after \d+ β-steps/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
  it("7. no phantom α-step for a bound name that looks like a definition", () => {
    const r = nf("λISZERO.(λx.λFALSE.x) ISZERO");
    expect(r.outcome!.steps.filter((s) => s.rule === "α")).toHaveLength(0);
    expect(r.normalForm).toBe("λISZERO.λFALSE.ISZERO");
  });
  it("8. let rec on the name Y still ties the knot with the library's Y", () => {
    const r = nf("let rec Y = λf.λn.n\nY I 3");
    expect(r.decoded?.numeral).toBe(3);
  });
  it("the lazy trace, the eager reducer and NbE agree on the capture cases that held", () => {
    for (const s of ["λFALSE.ISZERO 0", "λTRUE.ISZERO 0 TRUE", "λPRED.SUB 3 1 PRED", "let F = λg.g q\nλq.F q", "let F = g\n(λg.F) 1"]) {
      const r = nf(s);
      const eager = reduce(expandedTerm(s));
      expect(eager.status).toBe("normal");
      if (eager.status === "normal") expect(`${s}: ${r.normalForm}`).toBe(`${s}: ${alphaEquivalent(parseTerm(r.normalForm!), eager.term) ? r.normalForm : "MISMATCH " + r.normalForm}`);
      expect(r.caveats.join(" ")).not.toMatch(/FAILED/);
    }
  });
  it("judgment call adopted: redefining a library name says what it changes", () => {
    const r = nf("let FALSE = λx.λy.x\nISZERO 1");
    expect(r.caveats.join(" ")).toMatch(/FALSE redefined: .*ISZERO/);
  });
});

describe("graphs", () => {
  it("9. a self-loop does not hide the bipartite obstruction", () => {
    const e: string[] = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 12; j++) e.push(`a${i}-b${j}`);
    e.push("a0-a0");
    const r = tryGraph("hamiltonian\n" + e.join("\n"))!;
    expect(r.display[0]).toMatch(/^Hamiltonian cycle: NONE — proof: bipartite with parts of size 9 and 12/);
    expect(r.display[1]).toMatch(/^Hamiltonian path: NONE — proof: bipartite with parts of size 9 and 12/);
  });
  it("a directed 2-cycle is a Hamiltonian cycle; an undirected edge is not", () => {
    expect(hamiltonian(parseGraph("A->B\nB->A")!.graph, true)).toEqual([0, 1]);
    expect(hamiltonian(parseGraph("A->B")!.graph, true)).toBeNull();
    expect(hamiltonian(parseGraph("A-B")!.graph, true)).toBeNull();
    expect(tryGraph("hamiltonian\nA->B\nB->A")!.display[0]).toMatch(/^Hamiltonian cycle: yes — A → B → A/);
  });
});
