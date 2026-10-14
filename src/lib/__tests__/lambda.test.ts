// The untyped λ-calculus (lambda.ts).
//
// The oracle is the textbook: Church arithmetic has known answers, K I Ω is
// THE example separating normal from applicative order, and capture is the
// classic substitution bug. Every pin here is a fact a student could check by
// hand, not a value copied from the engine's own output.

import {
  parseTerm, show, reduce, substitute, alphaEquivalent, freeVars, deBruijn,
  decodeNumeral, decodeBoolean, evalAsNumeral, evalAsBoolean, principalType,
  solveLambda, parseLambdaRequest, expandedTerm, churchNumeral, termSize, isNormalForm,
  LambdaSyntaxError, MAX_STEPS, MAX_TERM_SIZE, MAX_TERM_DEPTH, MAX_LITERAL, LIBRARY_NAMES, library,
  v, lam, app, Term,
} from "../lambda";

const P = (s: string): Term => parseTerm(s);
const nf = (s: string): string => {
  const r = reduce(expandedTerm(s));
  if (r.status !== "normal") throw new Error(`no normal form: ${r.status}`);
  return show(r.term);
};
const num = (s: string): number | null => {
  const r = reduce(expandedTerm(s));
  return r.status === "normal" ? decodeNumeral(r.term) : null;
};
const bool = (s: string): boolean | null => {
  const r = reduce(expandedTerm(s));
  return r.status === "normal" ? decodeBoolean(r.term) : null;
};

describe("parsing", () => {
  it("reads λ, backslash and the word lambda as the same binder", () => {
    expect(show(P("λx.x"))).toBe("λx.x");
    expect(show(P("\\x.x"))).toBe("λx.x");
    expect(show(P("lambda x.x"))).toBe("λx.x");
  });
  it("application is left-associative and the body extends to the right", () => {
    expect(show(P("a b c"))).toBe("a b c");
    expect(deBruijn(P("a b c"))).toBe(deBruijn(P("(a b) c")));
    expect(deBruijn(P("a (b c)"))).not.toBe(deBruijn(P("(a b) c")));
    expect(deBruijn(P("λx.x y"))).toBe(deBruijn(P("λx.(x y)")));
    expect(deBruijn(P("λx.x y"))).not.toBe(deBruijn(P("(λx.x) y")));
  });
  it("λx y.M is λx.λy.M", () => {
    expect(alphaEquivalent(P("λx y.x"), P("λx.λy.x"))).toBe(true);
  });
  it("λxy.x reads as two binders, with a note, when xy itself is never used", () => {
    const notes: { text: string }[] = [];
    const t = parseTerm("λxy.x", notes);
    expect(alphaEquivalent(t, P("λx.λy.x"))).toBe(true);
    expect(notes.map((n) => n.text).join(" ")).toMatch(/one binder per letter/);
  });
  it("but λxy.xy keeps xy as ONE variable, because the whole name is used", () => {
    const notes: { text: string }[] = [];
    const t = parseTerm("λxy.xy", notes);
    expect(alphaEquivalent(t, P("λz.z"))).toBe(true);
    expect(notes.map((n) => n.text).join(" ")).toMatch(/"xy" is ONE variable here/);
  });
  it("xx inside λx reads as x x, noted; foo stays one variable", () => {
    const notes: { text: string }[] = [];
    const t = parseTerm("λx.xx", notes);
    expect(alphaEquivalent(t, P("λx.x x"))).toBe(true);
    expect(notes[0].text).toMatch(/Read "xx" as x x/);
    const n2: { text: string }[] = [];
    expect(show(parseTerm("λx.foo", n2))).toBe("λx.foo");
    expect(n2).toHaveLength(0);
  });
  it("integers are Church numerals, capped", () => {
    expect(alphaEquivalent(P("2"), P("λf.λx.f (f x)"))).toBe(true);
    expect(alphaEquivalent(P("0"), P("λf.λx.x"))).toBe(true);
    expect(() => P(String(MAX_LITERAL + 1))).toThrow(LambdaSyntaxError);
    expect(termSize(churchNumeral(MAX_LITERAL))).toBe(2 * MAX_LITERAL + 3);
  });
  it("subscript digits and primes are identifier characters, so renamed variables parse back", () => {
    expect(show(P("λx₁.x₁"))).toBe("λx₁.x₁");
    expect(show(P("λx'.x'"))).toBe("λx'.x'");
  });
  it("syntax errors carry a position", () => {
    expect(() => P("(λx.x")).toThrow(/Missing "\)"/);
    expect(() => P("λ.x")).toThrow(/variable name/);
    expect(() => P("λx x")).toThrow(/Expected "\."/);
    expect(() => P("x )")).toThrow(/position 3/);
    expect(() => P("x + y")).toThrow(/Unexpected character "\+"/);
  });
  it("show is a round trip: parse(show(t)) ≡ t", () => {
    for (const s of ["λx.λy.x y (λz.z) x", "(λx.x) (λy.y) z", "a (b (c d)) e", "λf.(λx.f (x x)) (λx.f (x x))"]) {
      const t = P(s);
      expect(alphaEquivalent(parseTerm(show(t)), t)).toBe(true);
    }
  });
  it("show uses the fewest parentheses that preserve structure", () => {
    expect(show(P("(a b) c"))).toBe("a b c");
    expect(show(P("a (b c)"))).toBe("a (b c)");
    expect(show(P("(λx.x) y"))).toBe("(λx.x) y");
    expect(show(P("y (λx.x)"))).toBe("y (λx.x)");
    expect(show(P("λx.(x y)"))).toBe("λx.x y");
  });
});

describe("substitution", () => {
  it("is capture-avoiding: (λx.λy.x) y must NOT become λy.y", () => {
    const r = reduce(P("(λx.λy.x) y"));
    expect(r.status).toBe("normal");
    if (r.status !== "normal") return;
    // The result is a constant function returning the FREE y.
    expect(alphaEquivalent(r.term, P("λz.y"))).toBe(true);
    expect(freeVars(r.term)).toEqual(new Set(["y"]));
    expect(r.steps.some((s) => s.rule === "α")).toBe(true);
  });
  it("renames with a subscript and the renamed term parses back", () => {
    const renames: { from: string; to: string }[] = [];
    const out = substitute(P("λy.x y"), "x", v("y"), renames);
    expect(renames).toEqual([{ from: "y", to: "y₁" }]);
    expect(show(out)).toBe("λy₁.y y₁");
    expect(alphaEquivalent(parseTerm(show(out)), out)).toBe(true);
  });
  it("does not rename when there is nothing to capture", () => {
    const renames: { from: string; to: string }[] = [];
    substitute(P("λy.x"), "x", v("z"), renames);
    expect(renames).toEqual([]);
  });
  it("does not rename a binder whose body never mentions x (the cheap path)", () => {
    const renames: { from: string; to: string }[] = [];
    const out = substitute(P("λy.y"), "x", v("y"), renames);
    expect(renames).toEqual([]);
    expect(show(out)).toBe("λy.y");
  });
  it("a shadowing binder blocks substitution", () => {
    expect(show(substitute(P("λx.x"), "x", v("z")))).toBe("λx.x");
  });
  it("chooses x₂ when x₁ is already taken", () => {
    const renames: { from: string; to: string }[] = [];
    substitute(P("λx.λx₁.x y x₁"), "y", v("x"), renames);
    // Outer λx captures the free x of N: renamed to x₂ (x₁ is in use).
    expect(renames[0]).toEqual({ from: "x", to: "x₂" });
  });
});

describe("α-equivalence", () => {
  it("ignores bound names and respects free ones", () => {
    expect(alphaEquivalent(P("λx.x"), P("λy.y"))).toBe(true);
    expect(alphaEquivalent(P("λx.y"), P("λx.z"))).toBe(false);
    expect(alphaEquivalent(P("λx.λy.x"), P("λy.λx.y"))).toBe(true);
    expect(alphaEquivalent(P("λx.λy.x"), P("λx.λy.y"))).toBe(false);
  });
});

describe("β-reduction: the textbook results", () => {
  it("identity, K and S", () => {
    expect(nf("I a")).toBe("a");
    expect(nf("K a b")).toBe("a");
    expect(nf("S K K a")).toBe("a");
    expect(nf("(λx.λy.λz.x z (y z)) a b c")).toBe("a c (b c)");
  });
  it("Church arithmetic", () => {
    expect(num("SUCC 0")).toBe(1);
    expect(num("PLUS 2 3")).toBe(5);
    expect(num("MULT 3 4")).toBe(12);
    expect(num("POW 2 3")).toBe(8);
    expect(num("PRED 5")).toBe(4);
    expect(num("PRED 0")).toBe(0);
    expect(num("SUB 7 3")).toBe(4);
    expect(num("SUB 3 7")).toBe(0); // truncated subtraction
  });
  it("Church booleans", () => {
    expect(bool("AND TRUE FALSE")).toBe(false);
    expect(bool("OR FALSE TRUE")).toBe(true);
    expect(bool("NOT TRUE")).toBe(false);
    expect(bool("ISZERO 0")).toBe(true);
    expect(bool("ISZERO 3")).toBe(false);
    expect(bool("LEQ 2 5")).toBe(true);
    expect(bool("LEQ 5 2")).toBe(false);
    expect(bool("EQ 4 4")).toBe(true);
    expect(bool("EQ 4 5")).toBe(false);
    expect(num("IF TRUE 1 2")).toBe(1);
    expect(num("IF FALSE 1 2")).toBe(2);
  });
  it("pairs", () => {
    expect(num("FST (PAIR 3 4)")).toBe(3);
    expect(num("SND (PAIR 3 4)")).toBe(4);
  });
  it("the step count for (λx.x) a is exactly 1, with the redex named", () => {
    const r = reduce(P("(λx.x) a"));
    expect(r.status).toBe("normal");
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].rule).toBe("β");
    expect(r.steps[0].detail).toBe("(λx.x) a");
  });
  it("a normal form reduces in zero steps", () => {
    const r = reduce(P("λx.x"));
    expect(r.status).toBe("normal");
    expect(r.steps).toHaveLength(0);
    expect(isNormalForm(P("λx.x x"))).toBe(true);
    expect(isNormalForm(P("(λx.x) y"))).toBe(false);
  });
  it("reduces under binders (full normal form, not weak head)", () => {
    expect(nf("λy.(λx.x) y")).toBe("λy.y");
  });
});

describe("strategies", () => {
  it("K I OMEGA: normal order answers I, applicative order diverges", () => {
    const n = reduce(expandedTerm("K I OMEGA"), "normal");
    expect(n.status).toBe("normal");
    if (n.status === "normal") expect(show(n.term)).toBe("λx.x");
    const a = reduce(expandedTerm("K I OMEGA"), "applicative");
    expect(a.status).toBe("diverges");
    if (a.status === "diverges") expect(a.cycleLength).toBe(1);
  });
  it("OMEGA itself is a proven cycle of length 1 under both strategies", () => {
    for (const s of ["normal", "applicative"] as const) {
      const r = reduce(expandedTerm("OMEGA"), s);
      expect(r.status).toBe("diverges");
      if (r.status === "diverges") expect(r.cycleLength).toBe(1);
    }
  });
  it("a cycle longer than one is detected too", () => {
    // T = (λx.x x) ((λy.y) (λx.x x)). Normal order contracts the OUTER redex
    // first: T → N N with N = (λy.y)(λx.x x); then the leftmost N → λx.x x,
    // giving (λx.x x) N — which is T again. A 2-cycle, by hand.
    const r = reduce(P("(λx.x x) ((λy.y) (λx.x x))"), "normal");
    expect(r.status).toBe("diverges");
    if (r.status === "diverges") expect(r.cycleLength).toBe(2);
  });
  it("both strategies agree on every normalising library computation", () => {
    for (const s of ["PLUS 2 3", "MULT 2 3", "AND TRUE FALSE", "FST (PAIR 1 2)", "PRED 3"]) {
      const t = expandedTerm(s);
      const n = reduce(t, "normal");
      const a = reduce(t, "applicative");
      expect(n.status).toBe("normal");
      expect(a.status).toBe("normal");
      if (n.status === "normal" && a.status === "normal") expect(alphaEquivalent(n.term, a.term)).toBe(true);
    }
  });
});

describe("the caps bound time, and say which one fired", () => {
  it("a slowly growing term without a cycle hits the work budget, and says so", () => {
    // (λx.x x x) applied to itself adds one application per step; neither the
    // size cap nor the step cap fires first — the WORK budget does, which is
    // the one that bounds time.
    const t0 = Date.now();
    const r = reduce(P("(λx.x x x) (λx.x x x)"));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.status).toBe("capped");
    if (r.status === "capped") expect(r.reason).toMatch(/work budget/);
  });
  it("a fast-growing term hits the size cap first, and says so", () => {
    const A = "(λx.x x x x x x x x)";
    const t0 = Date.now();
    const r = reduce(P(`${A} ${A}`));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.status).toBe("capped");
    if (r.status === "capped") {
      expect(r.reason).toMatch(/grew past/);
      expect(r.steps.length).toBeLessThan(MAX_STEPS);
    }
  });
  it("2 2 2 2 (65,536) is refused by the size cap, not attempted", () => {
    const t0 = Date.now();
    const r = reduce(P("2 2 2 2"));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.status).toBe("capped");
  });
  it("the step cap is reported as a cap, never as divergence", () => {
    // A long but terminating computation forced under the cap.
    const r = reduce(expandedTerm("MULT 30 30"), "normal", 5);
    expect(r.status).toBe("capped");
    if (r.status === "capped") expect(r.reason).toMatch(/within 5 β-steps/);
  });
  it("Y f under normal order is capped (it unfolds forever without repeating)", () => {
    const t0 = Date.now();
    const r = reduce(expandedTerm("Y f"));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.status).not.toBe("normal");
  });
  it("the largest literal reduces and prints without overflowing the stack", () => {
    const t0 = Date.now();
    const r = solveLambda(`SUCC ${MAX_LITERAL}`)!;
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.decoded?.numeral).toBe(MAX_LITERAL + 1);
    expect(termSize(r.outcome!.term)).toBeLessThanOrEqual(MAX_TERM_SIZE);
  });
  it("MAX_STEPS and MAX_TERM_SIZE are finite and modest", () => {
    expect(Number.isFinite(MAX_STEPS)).toBe(true);
    expect(MAX_STEPS).toBeLessThanOrEqual(5000);
    expect(MAX_TERM_SIZE).toBeLessThanOrEqual(20000);
  });
  it("deep parentheses and deep binders are refused by name", () => {
    expect(() => P("(".repeat(500) + "x" + ")".repeat(500))).toThrow(/nested deeper/);
    expect(() => P("λx.".repeat(500) + "x")).toThrow(/nested deeper/);
  });
  it("a term at the depth cap goes through every walker; one past it is refused by name, not by RangeError", () => {
    const wide = (n: number): string => "x ".repeat(n).trim();
    const ok = solveLambda(`(λz.z) (λx.${wide(MAX_TERM_DEPTH - 2)})`)!;
    expect(ok.outcome!.status).toBe("normal");
    // x x x… is self-application, so the honest type line is "none"; what
    // matters is that the type walker produced a line rather than overflowing.
    expect(ok.display.some((l) => /^Simple type of the term as written: none/.test(l))).toBe(true);
    expect(() => solveLambda(`λx.${wide(MAX_TERM_DEPTH + 5)}`)).toThrow(/nests \d+ deep, above the 1500-deep cap/);
    expect(() => solveLambda(`let A = λx.${wide(MAX_TERM_DEPTH + 5)}\nA`)).toThrow(/Line 1.*nests \d+ deep/);
    // Depth is also pre-checked per step: a deep argument under a deep body.
    const r = reduce(P(`(λx.x ${wide(1000)}) (λy.${wide(1000)})`));
    expect(r.status).toBe("capped");
    if (r.status === "capped") expect(r.reason).toMatch(/could nest the term \d+ deep, past the 1500-deep cap/);
  });
});

describe("decoding", () => {
  it("reads Church numerals with any binder names", () => {
    expect(decodeNumeral(P("λg.λy.g (g (g y))"))).toBe(3);
    expect(decodeNumeral(P("λf.λx.x"))).toBe(0);
    expect(decodeNumeral(P("λf.λx.f"))).toBeNull();
    expect(decodeNumeral(P("λf.λx.x f"))).toBeNull();
    expect(decodeNumeral(P("λf.λf.f"))).toBe(0); // shadowed binder: still Church 0
  });
  it("reads Church booleans", () => {
    expect(decodeBoolean(P("λa.λb.a"))).toBe(true);
    expect(decodeBoolean(P("λa.λb.b"))).toBe(false);
    expect(decodeBoolean(P("λa.λb.c"))).toBeNull();
    expect(decodeBoolean(P("λa.λa.a"))).toBe(false); // shadowed binder: still FALSE
  });
});

describe("the independent evaluator", () => {
  it("agrees with the reducer on arithmetic, by a different mechanism", () => {
    expect(evalAsNumeral(expandedTerm("PLUS 2 3"))).toBe(5);
    expect(evalAsNumeral(expandedTerm("MULT 6 7"))).toBe(42);
    expect(evalAsNumeral(expandedTerm("POW 2 10"))).toBe(1024);
    expect(evalAsNumeral(expandedTerm("PRED 0"))).toBe(0);
  });
  it("is lazy: K 3 OMEGA evaluates (the diverging argument is never forced)", () => {
    expect(evalAsNumeral(expandedTerm("K 3 OMEGA"))).toBe(3);
  });
  it("returns null, never a number, when it cannot decide", () => {
    expect(evalAsNumeral(expandedTerm("OMEGA"))).toBeNull();
    expect(evalAsNumeral(P("λx.λy.x"))).toBeNull(); // K succ 0 = succ, not a number
    expect(evalAsNumeral(P("y"))).toBeNull(); // free variable: stuck
    // I is NOT a numeral but I succ 0 = succ 0 = 1 — the evaluator cannot
    // tell, which is why the reducer's structural decode is the primary
    // answer and the evaluator only CONFIRMS a decoded result.
    expect(evalAsNumeral(P("λx.x"))).toBe(1);
    expect(decodeNumeral(P("λx.x"))).toBeNull();
  });
  it("evaluates booleans", () => {
    expect(evalAsBoolean(expandedTerm("AND TRUE FALSE"))).toBe(false);
    expect(evalAsBoolean(expandedTerm("ISZERO 0"))).toBe(true);
  });
});

describe("simple types", () => {
  it("principal types of the classics", () => {
    expect(principalType(P("λx.x"))).toBe("α → α");
    expect(principalType(P("λx.λy.x"))).toBe("α → β → α");
    expect(principalType(P("λf.λx.f (f x)"))).toBe("(α → α) → α → α");
    expect(principalType(P("λx.λy.λz.x z (y z)"))).toBe("(α → β → γ) → (α → β) → α → γ");
    expect(principalType(P("λf.λg.λx.f (g x)"))).toBe("(α → β) → (γ → α) → γ → β");
  });
  it("self-application has no simple type (occurs check)", () => {
    expect(principalType(P("λx.x x"))).toBeNull();
    expect(principalType(expandedTerm("Y"))).toBeNull();
    expect(principalType(expandedTerm("OMEGA"))).toBeNull();
  });
  it("free variables get type variables", () => {
    // Type variables are named in order of first appearance in the OUTPUT.
    expect(principalType(P("f x"))).toBe("α");
    expect(principalType(P("λx.f x"))).toBe("α → β");
    expect(principalType(P("λx.f x x"))).toBe("α → β");
  });
  it("parenthesises only on the left of an arrow", () => {
    expect(principalType(P("λf.λx.f x"))).toBe("(α → β) → α → β");
    expect(principalType(P("λx.λf.f x"))).toBe("α → (α → β) → β");
  });
});

describe("the library", () => {
  it("every name parses, is closed, and the combinator identities hold", () => {
    const lib = library();
    for (const n of LIBRARY_NAMES) {
      expect(lib.has(n)).toBe(true);
      // Closed modulo the library itself: bodies stay lazy and may NAME other entries.
      expect([...freeVars(lib.get(n)!)].filter((x) => !lib.has(x))).toEqual([]);
    }
    expect(nf("B f g x")).toBe("f (g x)");
    expect(nf("C f x y")).toBe("f y x");
    expect(nf("W f x")).toBe("f x x");
  });
  it("Y is a fixed-point combinator: Y g → g (Y g) in one unfolding", () => {
    const t = expandedTerm("Y g");
    const r = reduce(t, "normal", 2);
    // After two normal-order steps: g ((λx.g (x x)) (λx.g (x x))), i.e. g applied to the unfolded Y g.
    expect(r.status).toBe("capped");
    expect(show(r.term)).toBe("g ((λx.g (x x)) (λx.g (x x)))");
  });
  it("a let definition overrides a library name and may use earlier definitions", () => {
    const r = solveLambda("let TWICE = λf.λx.f (f x)\nlet FOUR = TWICE TWICE\nFOUR SUCC 0")!;
    expect(r.decoded?.numeral).toBe(4);
    const r2 = solveLambda("K = λx.λy.y\nK a b")!;
    expect(r2.normalForm).toBe("b");
  });
  it("a plain let that names itself is refused with the let rec hint; naming an EARLIER definition expands it", () => {
    expect(() => solveLambda("let F = λn.F n\nfree F")).toThrow(/write "let rec F = …" for recursion|Write "let rec F = …"/);
    const r = solveLambda("let F = λx.x\nlet F = λn.F n\nF 3")!;
    expect(r.decoded?.numeral).toBe(3);
  });
});

describe("solveLambda — the front door", () => {
  it("empty input is null; a syntax error throws", () => {
    expect(solveLambda("")).toBeNull();
    expect(() => solveLambda("(λx.x")).toThrow(LambdaSyntaxError);
  });
  it("PLUS 2 3 reports the numeral, the verification, and the type", () => {
    const r = solveLambda("PLUS 2 3")!;
    expect(r.decoded?.numeral).toBe(5);
    expect(r.verified).toBe(true);
    expect(r.display.join("\n")).toMatch(/Normal form: λf\.λx\.f \(f \(f \(f \(f x\)\)\)\)/);
    expect(r.display.join("\n")).toMatch(/= Church numeral 5/);
    expect(r.display.join("\n")).toMatch(/independent environment-based evaluator also gives 5/);
    expect(r.type).toBe("(α → α) → α → α");
    expect(r.steps[0]).toMatch(/^Start: /);
    expect(r.steps.length).toBeGreaterThan(1);
  });
  it("a boolean result is decoded and verified", () => {
    const r = solveLambda("AND TRUE (NOT FALSE)")!;
    expect(r.decoded?.boolean).toBe(true);
    expect(r.verified).toBe(true);
  });
  it("Church 0 says it is also FALSE", () => {
    expect(solveLambda("PRED 1")!.display.join(" ")).toMatch(/Church numeral 0, which is the same term as FALSE/);
  });
  it("the verbs", () => {
    expect(solveLambda("type λx.x")!.display.join(" ")).toMatch(/Type: α → α/);
    expect(solveLambda("type of λx.x x")!.display.join(" ")).toMatch(/not simply typable/);
    expect(solveLambda("free λx.x y z")!.display.join(" ")).toMatch(/Free: y, z/);
    expect(solveLambda("free λx.x")!.display.join(" ")).toMatch(/Closed term/);
    expect(solveLambda("alpha λx.x = λy.y")!.display.join(" ")).toMatch(/^(?!.*NOT).*α-equivalent/);
    expect(solveLambda("alpha λx.y = λx.z")!.display.join(" ")).toMatch(/NOT α-equivalent/);
    expect(solveLambda("alpha I = λz.z")!.display.join(" ")).not.toMatch(/NOT/);
  });
  it("keywords need a word boundary: a variable called fvx is not 'fv x'", () => {
    const r = solveLambda("fvx")!;
    expect(r.title).toBe("β-reduction");
    expect(r.normalForm).toBe("fvx");
    expect(solveLambda("typed")!.normalForm).toBe("typed");
  });
  it("strategy keywords", () => {
    const a = solveLambda("applicative K I OMEGA")!;
    expect(a.outcome!.status).toBe("diverges");
    expect(a.display.join(" ")).toMatch(/Normal order DOES terminate on this term: λx\.x/);
    const n = solveLambda("call by value: (λx.y) ((λz.z) w)")!;
    expect(n.normalForm).toBe("y");
    expect(n.display[0]).toMatch(/applicative order/);
    expect(solveLambda("normal order K I OMEGA")!.normalForm).toBe("λx.x");
    expect(solveLambda("reduce the normal form of PLUS 1 1")!.decoded?.numeral).toBe(2);
    expect(solveLambda("evaluate: MULT 2 2")!.decoded?.numeral).toBe(4);
  });
  it("a proven divergence is reported as such, and the cap as a cap", () => {
    const d = solveLambda("OMEGA")!;
    expect(d.display.join(" ")).toMatch(/DIVERGES: after 1 β-step the term returned to an earlier form \(a cycle of length 1\)/);
    const c = solveLambda("(λx.x x x x x x x x) (λx.x x x x x x x x)")!;
    expect(c.display.join(" ")).toMatch(/No normal form found: the term grew past/);
    const s = solveLambda("(λx.x x x) (λx.x x x)")!;
    expect(s.display.join(" ")).toMatch(/No normal form found: the reduction exceeded its work budget/);
    expect(c.caveats.join(" ")).toMatch(/not a theorem/);
    const y = solveLambda("Y f")!;
    expect(y.display.join(" ")).toMatch(/No normal form found/);
  });
  it("a lone definition line is refused with what to do", () => {
    expect(() => solveLambda("TWICE = λf.λx.f (f x)")).toThrow(/line after it/);
  });
  it("a middle line that is not a definition is named", () => {
    expect(() => solveLambda("λx.x\nλy.y")).toThrow(/Line 1 is not a definition/);
  });
  it("notes from the parser reach the caveats", () => {
    const r = solveLambda("λx.xx")!;
    expect(r.caveats.join(" ")).toMatch(/Read "xx" as x x/);
  });
  it("the displayed normal form parses back to an α-equivalent term (display contract)", () => {
    for (const s of ["PLUS 2 3", "(λx.λy.x) y", "S K K", "λx.λy.λz.x (y z)", "PAIR a b"]) {
      const r = solveLambda(s)!;
      expect(r.normalForm).toBeDefined();
      const back = parseTerm(r.normalForm!);
      expect(alphaEquivalent(back, r.outcome!.term)).toBe(true);
    }
  });
  it("more than 40 steps are elided with a count", () => {
    // Church addition is cheap in steps (f^m is literal); Kleene's
    // predecessor runs its argument, so SUB 10 5 takes over a hundred.
    const r = solveLambda("SUB 10 5")!;
    expect(r.outcome!.steps.length).toBeGreaterThan(40);
    expect(r.steps.some((l) => /more steps not listed/.test(l))).toBe(true);
    expect(r.decoded?.numeral).toBe(5);
  });
  it("every reported result that decodes is verified true, never false, across the library", () => {
    const cases = ["PLUS 3 4", "MULT 5 5", "SUB 9 4", "POW 3 3", "ISZERO (SUB 2 2)", "EQ 3 3", "LEQ 4 3", "FST (PAIR 7 8)", "NOT (NOT TRUE)", "OR FALSE FALSE"];
    for (const c of cases) {
      const r = solveLambda(c)!;
      expect(`${c}: ${r.verified}`).toBe(`${c}: true`);
    }
  });
});

// ---------------------------------------------------------------------------
// Pins from the independent adversarial pass over the first version. Each of
// these was a confirmed defect; the expected values were computed by hand.

describe("adversarial pass — closed defects", () => {
  it("1. no phantom α-steps: exactly the renames that happen, and no 2^d blow-up", () => {
    const r = solveLambda("(λx.λy.λz.x y z) (y z)")!;
    expect(r.normalForm).toBe("λy₁.λz₁.y z y₁ z₁");
    expect(r.outcome!.steps.filter((s) => s.rule === "α")).toHaveLength(2);
    const r2 = solveLambda("(λx.λy.λy.x) y")!;
    expect(r2.normalForm).toBe("λy₁.λy₁.y");
    // One rename per binder? Both binders are named y and both capture: two.
    expect(r2.outcome!.steps.filter((s) => s.rule === "α")).toHaveLength(2);
    const letters = "abcdefghijklmnopq";
    const t0 = Date.now();
    const r3 = solveLambda(`(λx${letters}.x ${letters.split("").join(" ")}) (${letters.split("").join(" ")})`)!;
    expect(Date.now() - t0).toBeLessThan(3000); // gross-freeze bound; ~20 ms alone
    expect(r3.outcome!.steps.filter((s) => s.rule === "α")).toHaveLength(letters.length);
  });
  it("2. a definition's free variable is never captured by the user's binder", () => {
    const r = solveLambda("let F = λx.y\n(λy.F y) z")!;
    expect(r.normalForm).toBe("y");
    expect(r.caveats.join(" ")).toMatch(/y renamed to y₁ so a definition/);
    const r2 = solveLambda("let F = y\n(λy.λz.F) a b")!;
    expect(r2.normalForm).toBe("y");
  });
  it("3. Church 0 under a shadowed binder decodes (λx.λx.x is 0 and FALSE)", () => {
    expect(decodeNumeral(P("λx.λx.x"))).toBe(0);
    expect(decodeBoolean(P("λx.λx.x"))).toBe(false);
    expect(decodeNumeral(P("λf.λf.f"))).toBe(0);
    expect(decodeNumeral(P("λf.λf.f f"))).toBeNull();
    for (const s of ["POW 0 2", "1 0", "2 0", "(λn.n 0) 1"]) {
      const r = solveLambda(s)!;
      expect(`${s}: ${r.decoded?.numeral}/${r.verified}`).toBe(`${s}: 0/true`);
    }
  });
  it("4. an exponential principal type is refused by budget, quickly, under both verbs", () => {
    const D = "let D = λx.PAIR x x";
    const nest = (n: number): string => "D (".repeat(n) + "z" + ")".repeat(n);
    const t0 = Date.now();
    const r = solveLambda(`${D}\ntype ${nest(22)}`)!;
    expect(Date.now() - t0).toBeLessThan(5000); // gross-freeze bound; ~300 ms alone
    expect(r.display.join(" ")).toMatch(/too large to show/);
    expect(r.type).toBeNull();
    const t1 = Date.now();
    const r2 = solveLambda(`${D}\nK a (${nest(22)})`)!;
    expect(Date.now() - t1).toBeLessThan(5000); // gross-freeze bound
    expect(r2.normalForm).toBe("a");
    expect(r2.display.join(" ")).toMatch(/too large to show/);
    // Modest types still print in full.
    expect(solveLambda(`${D}\ntype ${nest(3)}`)!.type).toMatch(/→/);
  });
  it("5. 'normal form of X' and 'normal order: reduce X' are prose, not terms", () => {
    expect(solveLambda("normal form of (λx.x) y")!.normalForm).toBe("y");
    expect(solveLambda("the normal form of (λx.x) y")!.normalForm).toBe("y");
    expect(solveLambda("normal order: reduce (λx.x) y")!.normalForm).toBe("y");
    expect(solveLambda("reduce the term (λx.x) y")!.normalForm).toBe("y");
    expect(solveLambda("type of the normal form of λx.x")!.type).toBe("α → α");
    // A variable genuinely called form is still a variable.
    expect(solveLambda("form")!.normalForm).toBe("form");
  });
  it("6. the caps bound time at well under a second on ordinary capped inputs", () => {
    for (const s of ["(λx.x x x) (λx.x x x)", "3 3 3", "applicative (λx.y) ((λx.x x x) (λx.x x x))", "EQ 20 20", "Y f"]) {
      const t0 = Date.now();
      const r = solveLambda(s)!;
      const ms = Date.now() - t0;
      // The claim is "well under a second alone"; the bound is a gross-freeze
      // bound because a parallel jest run multiplies wall-clock several-fold
      // (recorded flake class: 3047 ms and 3102 ms under 341- and 352-file
      // runs on 2026-10-14 against a 3 s bound — raised to 5 s).
      expect(`${s}: ${ms < 5000 ? "fast" : `SLOW ${ms}ms`}`).toBe(`${s}: fast`);
      expect(r.outcome!.status).not.toBe("normal");
    }
  });
  it("7. one β-step cannot jump past the size cap, and the input is size-checked", () => {
    // 40 copies of a 1003-node argument is 40,120 nodes from one step, while
    // the depths (40 + 503) stay under the depth cap, so the COPY check fires.
    const body = "x ".repeat(40).trim();
    const t0 = Date.now();
    const r = solveLambda(`(λx.${body}) 500`)!;
    expect(Date.now() - t0).toBeLessThan(5000); // gross-freeze bound; ~50 ms alone
    expect(r.outcome!.status).toBe("capped");
    expect(r.display.join(" ")).toMatch(/would copy a 1003-node argument 40 times/);
    expect(r.steps.join("\n").length).toBeLessThan(20000);
    // A term that is already over a cap as written: a wide chain is deep.
    const big = "x ".repeat(9000).trim();
    // Refused straight after the parse — before any recursive walker, whose
    // measured capacity (~9,500 on a wide chain) this would exhaust.
    expect(() => solveLambda(`λx.${big}`)).toThrow(/as written nests 9001 deep, above the 1500-deep cap/);
    // And one over the SIZE cap while shallow: a balanced tree, built directly.
    const bal = (d: number): Term => (d === 0 ? v("x") : app(bal(d - 1), bal(d - 1)));
    const r3 = reduce(bal(13)); // 2^14 - 1 nodes, 14 deep
    expect(r3.status).toBe("capped");
    if (r3.status === "capped") expect(r3.reason).toMatch(/as written has 16383 nodes, above the 8000-node cap/);
  });
  it("minor: real line numbers, located positions, and a lone surrogate never shows", () => {
    expect(() => solveLambda("let A = λx.x\n\nnot a def\nA")).toThrow(/Line 3 is not a definition/);
    expect(() => solveLambda("A = B = C\nA")).toThrow(/Line 1, in the term after "=": Unexpected character "="/);
    expect(() => solveLambda("type λx.x +")).toThrow(/In the term: Unexpected character "\+" at position 6/);
    expect(() => solveLambda("𝜆x.x ⊕")).toThrow(/Unexpected character "⊕"/);
    expect(solveLambda("𝜆x.x")!.normalForm).toBe("λx.x");
  });
  it("minor: shorthand heuristics never split a defined name", () => {
    const r = solveLambda("let xy = K\nλx.λy.xy a b")!;
    expect(r.normalForm).toBe("λx.λy.a");
    expect(r.caveats.join(" ")).not.toMatch(/Read "xy"/);
  });
  it("judgment calls made explicit: λxy.xy is one variable and says so; POW 2 0 is η-close to 1 and says so", () => {
    const r = solveLambda("λxy.xy")!;
    expect(r.normalForm).toBe("λxy.xy");
    expect(r.caveats.join(" ")).toMatch(/"xy" is ONE variable here/);
    expect(solveLambda("POW 2 0")!.caveats.join(" ")).toMatch(/η-equivalent to Church numeral 1/);
    expect(solveLambda("AND TRUE FALSE")!.display.join(" ")).toMatch(/Church numeral 0, which is the same term as FALSE/);
    expect(solveLambda("AND TRUE FALSE")!.decoded).toEqual({ numeral: 0, boolean: false });
  });
  it("Greek letters are variables; ^ is not a λ", () => {
    expect(solveLambda("(λα.α) β")!.normalForm).toBe("β");
    expect(() => solveLambda("x^y")).toThrow(/Unexpected character "\^"/);
  });
});

// ---------------------------------------------------------------------------
// v2.133.0 (SCOPE-COMPUTATION-THEORY §E.4): prose is refused by name, never
// reduced as free variables; hm and type scheme of are verbs.

describe("prose guard and the hm verbs", () => {
  it("hm λf.λx.f (f x) and type scheme of λx.λy.x are verbs, not free variables", () => {
    const r = solveLambda("hm λf.λx.f (f x)")!;
    expect(r.title).toBe("Hindley–Milner type");
    expect(r.display.join(" ")).not.toMatch(/Normal form|Free variable/);
    expect(solveLambda("type scheme of λx.λy.x")!.scheme).toBe("∀α β. α → β → α");
  });
  it("another domain's leading verb, or a bare connective, is refused by name, never reduced", () => {
    for (const [input, words] of [
      ["busy beaver 3", "busy beaver"],
      ["unify f(x) with g(x)", "unify"],
      ["pigeonhole 3 pigeons 2 holes", "pigeonhole"],
      ["scheme of λx.λy.x", "scheme of"],
      ["dpll λx.x", "dpll"],
      ["reduce foo with bar", "foo with bar"],
    ]) {
      expect(() => solveLambda(input)).toThrow(LambdaSyntaxError);
      expect(() => solveLambda(input)).toThrow(new RegExp(`"${words}" reads as prose, not as a λ-term: the λ kind's verbs are reduce, type, hm`));
    }
  });
  it("ordinary free-variable applications reduce exactly as in v2.132.0 (review regression)", () => {
    for (const [s, nf] of [["pair a b", "pair a b"], ["fst p", "fst p"], ["plus 2 3", null], ["map f xs", "map f xs"], ["x y", "x y"], ["f x", "f x"], ["s z", "s z"], ["foo", "foo"], ["foo λx.x", "foo (λx.x)"]] as const) {
      const r = solveLambda(s)!;
      expect(`${s}: ${r.title}`).toBe(`${s}: β-reduction`);
      if (nf) expect(r.normalForm).toBe(nf);
    }
    // The case hint survives as a CAVEAT, never a refusal.
    const r = solveLambda("succ 2")!;
    expect(r.title).toBe("β-reduction");
    expect(r.caveats.join(" ")).toMatch(/succ is a free variable here .*the library's SUCC is written in UPPERCASE/);
    // A bound or defined name is never flagged.
    expect(solveLambda("λsucc.succ 2")!.caveats.join(" ")).not.toMatch(/UPPERCASE/);
  });
  it("terms that look wordy but are terms still reduce", () => {
    expect(solveLambda("fvx")!.normalForm).toBe("fvx");
    expect(solveLambda("f x")!.normalForm).toBe("f x");
    expect(solveLambda("W I x")!.normalForm).toBe("x x"); // uppercase W is the library's W
    expect(solveLambda("let foo = λx.x\nfoo λy.y")!.normalForm).toBe("λy.y"); // a defined word is a name
    expect(solveLambda("λfoo.foo bar")!.normalForm).toBe("λfoo.foo bar");
    // Free multi-letter variables beside a λ, not leading: still terms.
    expect(solveLambda("(λx.x) foo bar")!.normalForm).toBe("foo bar");
    expect(solveLambda("λx.foo bar")!.normalForm).toBe("λx.foo bar");
  });
  it("a lowercase w is the hm verb ONLY before let or a λ-term; otherwise it is a free variable (review regression)", () => {
    expect(solveLambda("w x")!.normalForm).toBe("w x");
    expect(solveLambda("w y z")!.normalForm).toBe("w y z");
    expect(solveLambda("w λx.x")!.title).toBe("Hindley–Milner type");
    expect(solveLambda("w (λx.x)")!.type).toBe("α → α");
    expect(solveLambda("w let id = λx.x in id")!.type).toBe("α → α");
    expect(solveLambda("W I x")!.normalForm).toBe("x x");
  });
  it("one-line let … in … is hm, never 'That line is a definition'; a plain definition line still is", () => {
    expect(solveLambda("let id = λx.x in id 1")!.type).toBe("int");
    expect(() => solveLambda("TWICE = λf.λx.f (f x)")).toThrow(/line after it/);
  });
  it("type 1 and hm 1 each carry the caveat naming the other reading (§E.14)", () => {
    expect(solveLambda("type 1")!.caveats.join(" ")).toMatch(/under hm, 1 : int/);
    expect(solveLambda("hm 1")!.caveats.join(" ")).toMatch(/under type, 1 is the Church numeral/);
  });
});
