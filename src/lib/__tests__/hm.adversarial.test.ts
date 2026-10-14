// A hostile pass over the Hindley–Milner verb (house rule: separate from the
// acceptance file). Expected values by hand; the pure-λ ones are ALSO checked
// against the existing principalType on the let-expansion (§E.13).

import { solveLambda, principalType, hmOutcome, parseTerm, alphaEquivalent, LambdaSyntaxError } from "../lambda";
import { parseHM, expandLets } from "../hm";
import { show } from "../lambda";

const hm = (s: string) => solveLambda(s)!;
const text = (s: string) => hm(s).display.join("\n");
const timed = <T>(f: () => T): { v: T; ms: number } => { const t0 = Date.now(); const v = f(); return { v, ms: Date.now() - t0 }; };
// "< 1 s alone"; the bound is a gross-freeze bound because a parallel jest run
// multiplies wall-clock (the λ kind's recorded flake class).
const FREEZE_MS = 3000;

describe("let versus λ: the classic contrast", () => {
  it("let id = λx.x in id id instantiates the ∀ twice", () => {
    const r = hm("hm let id = λx.x in id id");
    expect(r.type).toBe("α → α");
    expect(r.steps.filter((s) => /instantiate id/.test(s))).toHaveLength(2);
  });
  it("(λid. id id) (λx.x): λ-bound → occurs check by name", () => {
    expect(text("hm (λid. id id) (λx.x)")).toMatch(/occurs check — α = α → β at id id — id is λ-bound, hence MONOMORPHIC/);
  });
  it("let f = λx.x in (f 1, f true) types; (λf.(f 1, f true)) (λx.x) is refused with the fix named", () => {
    expect(hm("hm let f = λx.x in (f 1, f true)").type).toBe("int × bool");
    const t = text("hm (λf.(f 1, f true)) (λx.x)");
    expect(t).toMatch(/clash int ≠ bool at f true — f is λ-bound, hence MONOMORPHIC; write let f = λx\.x in \(f 1, f true\) for polymorphism/);
  });
});

describe("scoping", () => {
  it("nested lets", () => {
    expect(hm("hm let id = λx.x in let k = λa.λb.a in k (id 1) (id true)").type).toBe("int");
    expect(hm("hm let a = 1 in let b = (a, true) in snd b").type).toBe("bool");
  });
  it("shadowing: let x = 1 in let x = true in x is bool, each x said monomorphic", () => {
    const r = hm("hm let x = 1 in let x = true in x");
    expect(r.type).toBe("bool");
    expect(r.display).toContain("x : int — no type variable to generalise, so no ∀");
    expect(r.display).toContain("x : bool — no type variable to generalise, so no ∀");
  });
  it("a type variable free in Γ blocks generalisation: f : ∀α. α → τ_y, y's type NOT generalised", () => {
    const r = hm("hm λy. let f = λx.y in (f 1, f true)");
    // x's variable is generalised, y's is not — so both uses return y's one type.
    expect(r.type).toBe("α → α × α");
    expect(r.display).toContain("Scheme: ∀β. β → α for f");
    expect(r.steps.join("\n")).toMatch(/generalise f : ∀γ\. γ → β — γ is not free in Γ/);
    // If y's type were (wrongly) generalised, (f 1, f true) would be α × β.
    expect(r.type).not.toBe("α → β × γ");
  });
  it("a λ-bound variable stays monomorphic under a let that uses it: λy. let g = y in (g 1, g true) clashes", () => {
    expect(text("hm λy. let g = y in (g 1, g true)")).toMatch(/clash int ≠ bool at g true/);
  });
});

describe("capture during the let-expansion (the cross-check's term)", () => {
  it("the open form is refused as unbound BEFORE any expansion (hm needs every name bound)", () => {
    expect(text("hm let f = λx.y in λy. f y")).toMatch(/unbound variable y/);
  });
  it("the closed form types as α → β → α and its expansion renames the inner y (a captured expansion would give α → β → β)", () => {
    const r = hm("hm λy. let f = λx.y in λy. f y");
    expect(r.type).toBe("α → β → α");
    const o = hmOutcome("hm λy. let f = λx.y in λy. f y")!;
    expect(alphaEquivalent(o.expansion!, parseTerm("λy.λy₁.(λx.y) y₁"))).toBe(true);
    expect(principalType(o.expansion!)).toBe("α → β → α");
  });
  it("capture through a library name: let f = K in λK. f K — the inner λK must not capture f's K", () => {
    const r = hm("hm let f = K in λK. f K");
    expect(r.type).toBe("α → β → α");
    const o = hmOutcome("hm let f = K in λK. f K")!;
    expect(alphaEquivalent(o.expansion!, parseTerm("λK₁.(λx.λy.x) K₁"))).toBe(true);
    expect(principalType(o.expansion!)).toBe("α → β → α");
  });
  it("a wide application chain is refused by the cap straight after the parse", () => {
    expect(() => hm(`hm λx.${"x ".repeat(9000).trim()}`)).toThrow(/nests 9001 deep, above the 1500-deep cap/);
  });
  it("expandLets on the open term renames y to y₁", () => {
    const flags = { unused: false };
    const e = expandLets(parseHM("let f = λx.y in λy. f y"), flags)!;
    expect(show(e)).toBe("λy₁.(λx.y) y₁");
  });
});

describe("failures by name", () => {
  it("if with mismatched branches → clash by name", () => {
    expect(text("hm if true then 1 else false")).toMatch(/clash int ≠ bool at the branches of if true then 1 else false/);
    expect(text("hm if 1 then 2 else 3")).toMatch(/clash int ≠ bool at the condition/);
  });
  it("fst (1, true) → int; snd → bool; fst of a non-pair → clash", () => {
    expect(hm("hm fst (1, true)").type).toBe("int");
    expect(hm("hm snd (1, true)").type).toBe("bool");
    expect(hm("hm snd (fst ((1, true), 2), λx.x)").type).toBe("α → α");
    expect(text("hm fst 1")).toMatch(/Not typable: clash/);
  });
  it("let rec on a non-function: x = 1 is int (monomorphic recursion said); x = (x, 1) fails the occurs check", () => {
    const r = hm("hm let rec x = 1 in x");
    expect(r.type).toBe("int");
    expect(r.steps.join("\n")).toMatch(/monomorphic recursion/);
    expect(text("hm let rec x = (x, 1) in x")).toMatch(/occurs check — α = α × int/);
  });
  it("unbound variable by name; Y named as untypable, not crashed", () => {
    expect(text("hm λx.z")).toMatch(/unbound variable z/);
    expect(text("hm Y")).toMatch(/Y has no simple type .*occurs check/);
  });
  it("an open earlier-line definition is named as open", () => {
    expect(text("let BB = λx.q\nhm BB")).toMatch(/BB is an open term \(q free in λx\.q\)/);
  });
  it("earlier-line definitions and library names keep their λ-types, polymorphically", () => {
    expect(hm("let id = λx.x\nhm (id 1, id true)").type).toBe("int × bool");
    expect(hm("hm K 1 true").type).toBe("int");
  });
  it("a triple and a list are refused by the hm reader, by name", () => {
    expect(() => hm("hm (1, 2, 3)")).toThrow(/A pair has two components/);
    expect(() => hm("hm [1, 2]")).toThrow(/list literals are not part of the hm reader/);
  });
  it("a let … in … on a non-final line is refused by name", () => {
    expect(() => hm("let f = λx.x in f\nf")).toThrow(/let … in … expression \(Hindley–Milner\), which must be the LAST line/);
  });
});

describe("caps, before the work, and time", () => {
  it("a 50-deep let nest types quickly; the step log is elided at 40 lines", () => {
    let s = "x50";
    for (let i = 50; i >= 1; i--) s = `let x${i} = ${i === 1 ? "λy.y" : `x${i - 1}`} in ${s}`;
    const { v: r, ms } = timed(() => hm(`hm ${s}`));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(r.type).toBe("α → α");
    expect(r.steps.some((l) => /^… \d+ more steps not listed\.$/.test(l))).toBe(true);
    expect(r.steps.filter((l) => /^\d+\. /.test(l))).toHaveLength(40);
  });
  it("a doubling pair nest ends in 'too large', not a hang", () => {
    let s = "x20";
    for (let i = 20; i >= 1; i--) s = `let x${i} = (x${i - 1}, x${i - 1}) in ${s}`;
    const { v: r, ms } = timed(() => hm(`hm let x0 = λy.y in ${s}`));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(r.display.join(" ")).toMatch(/too large to show/);
    expect(r.type ?? null).toBeNull();
  });
  it("a doubling pure-λ nest skips the expansion cross-check by name (a cap, not a defect)", () => {
    let s = "a14";
    for (let i = 14; i >= 2; i--) s = `let a${i} = a${i - 1} a${i - 1} in ${s}`;
    const { v: r, ms } = timed(() => hm(`hm let a1 = λx.x in ${s}`));
    expect(ms).toBeLessThan(FREEZE_MS);
    expect(r.type).toBe("α → α");
    expect(r.caveats.join(" ")).toMatch(/Cross-check against the simple type of the let-expansion: skipped — the expansion exceeds the 8,000-node cap/);
  });
  it("parse depth is capped before any walker", () => {
    const deep = "(".repeat(450) + "1" + ")".repeat(450);
    expect(() => hm(`hm ${deep}`)).toThrow(LambdaSyntaxError);
    expect(() => hm(`hm ${deep}`)).toThrow(/nested deeper than 400/);
  });
  it("a derivation tree is drawn only up to 20 nodes, and says so beyond", () => {
    expect(hm("hm λx.x").svg).toMatch(/^<svg/);
    // 22 nodes: let, λx, x, 4 pairs, 5 applications of id (3 nodes each).
    const r = hm("hm let id = λx.x in (id 1, (id true, (id 2, (id 3, id 4))))");
    expect(r.type).toBe("int × (bool × (int × (int × int)))");
    expect(r.svg).toBeUndefined();
    expect(r.caveats.join(" ")).toMatch(/Derivation tree not drawn: \d+ nodes, above the 20-node figure cap/);
  });
});

describe("§E.13: every pure-λ §D input agrees with principalType on its expansion", () => {
  const pure = [
    "hm let id = λx.x in id id",
    "hm λf.λx.f (f x)",
    "hm let twice = λf.λx.f (f x) in twice twice",
    "hm λx.λy.x",
    "hm let compose = λf.λg.λx.f (g x) in compose",
    "hm let k = λa.λb.a in let i = λz.z in k i (k i)",
    "hm let s = λx.λy.λz.x z (y z) in let k = λa.λb.a in s k k",
    "hm let id = λx.x in let twice = λf.λx.f (f x) in twice id",
  ];
  it.each(pure)("%s", (input) => {
    const { v: r, ms } = timed(() => hm(input));
    expect(ms).toBeLessThan(FREEZE_MS);
    const o = hmOutcome(input)!;
    expect(o.expansion).not.toBeNull();
    expect(r.type).toBe(principalType(o.expansion!));
    expect(r.steps.join("\n")).toMatch(/Verified: the let-expansion/);
  });
  it("failures agree too: the expansion of a refused pure term is not simply typable", () => {
    for (const s of ["hm (λid. id id) (λx.x)", "hm λx.x x"]) {
      const o = hmOutcome(s)!;
      expect(o.type).toBeNull();
      expect(principalType(o.expansion ?? parseTerm(s.slice(3)))).toBeNull();
      expect(o.steps.join("\n")).toMatch(/not simply typable either/);
    }
  });
  it("an unused let-bound name: the check is one-way and says so", () => {
    expect(hm("hm let f = λx.x in λz.z").steps.join("\n")).toMatch(/a let-bound name is unused/);
    expect(hm("hm let f = λx.x x in λz.z").caveats.join(" ")).toMatch(/one-way check, said/);
  });
});
