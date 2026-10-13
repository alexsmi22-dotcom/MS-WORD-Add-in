// λ-calculus enhancements: η-reduction, SKI translation, combinatory
// reduction, Church lists, let rec. Oracles are the textbook identities.

import { solveLambda, parseTerm, toSKI, show, etaNormalize, decodeList, clReduce, alphaEquivalent, parseLambdaRequest, reduce } from "../lambda";

const P = (s: string) => parseTerm(s);

describe("η-reduction", () => {
  it("λx.f x → f, and λx.λy.g x y → g in two steps", () => {
    expect(show(etaNormalize(P("λx.f x")).term)).toBe("f");
    const r = etaNormalize(P("λx.λy.g x y"));
    expect(show(r.term)).toBe("g");
    expect(r.steps).toHaveLength(2);
  });
  it("does not η-reduce when x is free in M", () => {
    expect(etaNormalize(P("λx.x x")).steps).toHaveLength(0);
    expect(etaNormalize(P("λx.f x x")).steps).toHaveLength(0);
  });
  it("the eta verb gives the βη-normal form and decodes after η", () => {
    const r = solveLambda("eta POW 2 0")!;
    expect(r.display[0]).toBe("β-normal form: λx.x");
    expect(r.display[1]).toMatch(/Already η-normal/);
    const s = solveLambda("eta λf.λx.f x")!; // Church 1 is already η-normal? λf.λx.f x → λf.f → yes: two η-steps to I
    expect(s.display[1]).toBe("βη-normal form: λf.f");
    const u = solveLambda("eta λn.λf.λx.n f x")!;
    expect(u.display[1]).toBe("βη-normal form: λn.n");
  });
  it("the plain reduce result mentions an η-reducible normal form", () => {
    const r = solveLambda("λx.λy.g x y")!;
    expect(r.display.join(" ")).toMatch(/η-reduces further to: g \(2 η-steps\)/);
    const s = solveLambda("λf.λx.f x")!; // Church 1
    expect(s.decoded?.numeral).toBe(1);
    expect(s.display.join(" ")).toMatch(/η-reduces further to: λf.f/);
  });
});

describe("SKI", () => {
  it("the classics", () => {
    expect(show(toSKI(P("λx.x")))).toBe("I");
    expect(show(toSKI(P("λx.λy.x")))).toBe("K");
    expect(show(toSKI(P("λx.λy.λz.x z (y z)")))).toBe("S");
    expect(show(toSKI(P("λx.λy.y")))).toBe("K I");
    expect(show(toSKI(P("λx.f x")))).toBe("f"); // η rule
    expect(show(toSKI(P("λf.λx.f (f x)")))).toBe("S (S (K S) K) I");
  });
  it("the ski verb verifies extensionally", () => {
    for (const s of ["λx.λy.x", "λf.λx.f (f x)", "λx.λy.λz.x (y z)", "λx.x x", "λp.λq.p q p"]) {
      const r = solveLambda(`ski ${s}`)!;
      expect(`${s}: ${r.steps.join(" ")}`).toMatch(/Verified: applied to \d fresh variables?, the combinator term and the original reduce to the same normal form/);
      expect(r.caveats.join(" ")).not.toMatch(/FAILED/);
    }
    expect(solveLambda("ski PLUS")!.display[1]).toMatch(/^SKI: /);
  });
});

describe("combinatory reduction", () => {
  it("reduces with the combinator rules only", () => {
    const r = clReduce(P("S K K x"));
    expect(show(r.term)).toBe("x");
    expect(r.steps).toHaveLength(2); // S K K x → K x (K x) → x
    expect(r.steps[0]).toMatch(/^S K K x  →  K x \(K x\)/);
    expect(show(clReduce(P("B f g x")).term)).toBe("f (g x)");
    expect(show(clReduce(P("C f x y")).term)).toBe("f y x");
    expect(show(clReduce(P("W f x")).term)).toBe("f x x");
    expect(show(clReduce(P("S I I (S I I)")).term)).not.toBe(""); // capped, no throw
  });
  it("the cl verb keeps combinators as constants", () => {
    const r = solveLambda("cl S K K x")!;
    expect(r.display[1]).toBe("Normal form: x");
    expect(r.display[2]).toBe("2 combinator steps.");
    expect(r.caveats.join(" ")).toMatch(/treated as constants/);
    const c = solveLambda("cl S I I (S I I)")!;
    expect(c.display[1]).toMatch(/No combinator normal form within 500 steps/);
  });
});

describe("Church lists", () => {
  it("list literals, HEAD, TAIL, LENGTH, SUM, MAP, ISNIL", () => {
    expect(solveLambda("[1, 2, 3]")!.display.join(" ")).toMatch(/= list \[1, 2, 3\]/);
    expect(solveLambda("HEAD [1, 2, 3]")!.decoded?.numeral).toBe(1);
    expect(solveLambda("TAIL [1, 2, 3]")!.display.join(" ")).toMatch(/= list \[2, 3\]/);
    expect(solveLambda("LENGTH [1, 2, 3]")!.decoded?.numeral).toBe(3);
    expect(solveLambda("SUM [1, 2, 3]")!.decoded?.numeral).toBe(6);
    expect(solveLambda("MAP SUCC [1, 2, 3]")!.display.join(" ")).toMatch(/= list \[2, 3, 4\]/);
    expect(solveLambda("ISNIL [1]")!.decoded?.boolean).toBe(false);
    expect(solveLambda("ISNIL NIL")!.decoded?.boolean).toBe(true);
    expect(solveLambda("[TRUE, FALSE]")!.display.join(" ")).toMatch(/= list \[TRUE, FALSE\]/);
    expect(solveLambda("CONS 1 (CONS 2 NIL)")!.display.join(" ")).toMatch(/= list \[1, 2\]/);
  });
  it("the empty list is Church 0 and FALSE, and is reported as those", () => {
    const r = solveLambda("[]")!;
    expect(r.decoded?.numeral).toBe(0);
    expect(decodeList(P("λc.λn.n"))).toEqual([]);
    expect(decodeList(P("λc.λn.c n n"))).toBeNull(); // c applied to n: not a list
  });
  it("list syntax errors name the problem", () => {
    expect(() => solveLambda("[1, 2")).toThrow(/Expected "," or "\]"/);
  });
});

describe("let rec", () => {
  it("factorial through Y, under normal order", () => {
    const r = solveLambda("let rec FACT = λn.IF (ISZERO n) 1 (MULT n (FACT (PRED n)))\nFACT 3")!;
    expect(r.decoded?.numeral).toBe(6);
    expect(r.verified).toBe(true);
    expect(r.caveats.join(" ")).toMatch(/FACT is recursive: defined as Y \(λFACT\.…\)/);
  });
  it("a plain let leaves a self-reference free (and says so)", () => {
    const r = solveLambda("let F = λn.F n\nfree F")!;
    expect(r.display.join(" ")).toMatch(/Free: F/);
  });
  it("the recursive definition is bound, not free", () => {
    const req = parseLambdaRequest("let rec G = λn.G n\nfree G")!;
    expect(reduce(req.term, "normal", 0).status).toBe("capped"); // just parses; G expanded to Y(λG.…)
    expect(solveLambda("let rec G = λn.G n\nfree G")!.display.join(" ")).toMatch(/Closed term/);
  });
  it("Y-based recursion that never terminates is capped, not hung", () => {
    const t0 = Date.now();
    const r = solveLambda("let rec LOOP = λn.LOOP n\nLOOP 1")!;
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.outcome!.status).not.toBe("normal");
  });
});

describe("display contract for the new forms", () => {
  it("every displayed normal form still parses back", () => {
    for (const s of ["[1, 2]", "MAP SUCC [0]", "TAIL [1, 2, 3]", "ski λf.λx.f (f x)"]) {
      const r = solveLambda(s)!;
      const line = r.normalForm ?? r.display.find((d) => d.startsWith("SKI: "))!.slice(5);
      const back = parseTerm(line);
      if (r.normalForm) expect(alphaEquivalent(back, r.outcome!.term)).toBe(true);
      else expect(back.kind).toBeDefined();
    }
  });
});

describe("the independent evaluator is iterative", () => {
  it("verifies a 1000-deep Church numeral inside a full test file (no JS recursion per level)", () => {
    // The recursive version overflowed on POW 2 10 only when the whole file
    // ran (jest's deeper stack) and the catch-all reported it as "undecided".
    const r = solveLambda("PLUS 500 500")!;
    expect(r.decoded?.numeral).toBe(1000);
    expect(r.verified).toBe(true);
    // (POW 2 9 would be 512 but needs more than the 1000-step cap, so it is
    // not a normal form to verify; multiplication is cheap in steps.)
    expect(solveLambda("MULT 20 25")!.decoded?.numeral).toBe(500);
    expect(solveLambda("MULT 20 25")!.verified).toBe(true);
  });
});
