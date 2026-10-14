// Hindley–Milner (hm.ts via the λ kind) — every §D acceptance value of
// docs/SCOPE-COMPUTATION-THEORY.md, verbatim. The oracles are the brief's
// (computed by hand and against principalType on the let-expansion), not the
// engine's own output. One naming note: §D writes the two instances of id in
// `let id = λx.x in id id` as (β → β) → β → β and β → β; the engine prints
// them with α because the answer's α IS that variable — α-equivalent.

import { solveLambda, principalType, hmOutcome, HM_RE } from "../lambda";
import { parseScheme, showScheme, isInstance, HTy } from "../hm";

const hm = (s: string) => solveLambda(s)!;
const text = (s: string) => hm(s).display.join("\n");

describe("§D Hindley–Milner acceptance values", () => {
  it("let id = λx.x in (id 1, id true) → int × bool, ∀α. α → α, instantiated at int and bool; never 'a definition'", () => {
    const r = hm("hm let id = λx.x in (id 1, id true)");
    expect(r.title).toBe("Hindley–Milner type");
    expect(r.type).toBe("int × bool");
    expect(r.display).toContain("Type: int × bool");
    expect(r.display).toContain("Scheme: ∀α. α → α for id");
    expect(r.display).toContain("Instances of id: α ↦ int (int → int); α ↦ bool (bool → bool)");
    expect(r.steps.join("\n")).toMatch(/generalise id : ∀α\. α → α — α is not free in Γ/);
    expect(r.steps.join("\n")).toMatch(/instantiate id : ∀α\. α → α ↦ β → β/);
    expect(r.steps.join("\n")).toMatch(/unify β → β with int → γ ⇒ \{β ↦ int, γ ↦ int\}/);
    expect(r.svg).toMatch(/^<svg/);
    // Bare (no hm verb) is the same request, NOT "That line is a definition".
    expect(hm("let id = λx.x in (id 1, id true)").type).toBe("int × bool");
  });
  it("let id = λx.x in id id → α → α, scheme ∀α. α → α, both instances shown", () => {
    const r = hm("hm let id = λx.x in id id");
    expect(r.type).toBe("α → α");
    expect(r.scheme).toBe("∀α. α → α");
    expect(r.display).toContain("Scheme: ∀α. α → α for id");
    expect(r.display).toContain("Instances of id: α ↦ α → α ((α → α) → α → α); α ↦ α (α → α)");
    expect(hm("type let id = λx.x in id id").type).toBe("α → α");
    expect(hm("type let id = λx.x in id id").title).toBe("Hindley–Milner type");
  });
  it("λf.λx.f (f x) → (α → α) → α → α, never 'Normal form: hm (…)'", () => {
    const r = hm("hm λf.λx.f (f x)");
    expect(r.type).toBe("(α → α) → α → α");
    expect(text("hm λf.λx.f (f x)")).not.toMatch(/Normal form/);
  });
  it("(λid. id id) (λx.x) → not typable: id λ-bound, occurs check α = α → β, the let fix named", () => {
    const t = text("hm (λid. id id) (λx.x)");
    expect(t).toMatch(/Not typable: occurs check — α = α → β/);
    expect(t).toMatch(/id is λ-bound, hence MONOMORPHIC/);
    expect(t).toMatch(/write let id = λx\.x in id id/);
    expect(hm("hm (λid. id id) (λx.x)").type).toBeNull();
  });
  it("let twice = λf.λx.f (f x) in twice twice → (α → α) → α → α, equal to principalType of the expansion", () => {
    const r = hm("hm let twice = λf.λx.f (f x) in twice twice");
    expect(r.type).toBe("(α → α) → α → α");
    const o = hmOutcome("hm let twice = λf.λx.f (f x) in twice twice")!;
    expect(principalType(o.expansion!)).toBe("(α → α) → α → α");
    expect(r.steps.join("\n")).toMatch(/Verified: the let-expansion .* has principal simple type \(α → α\) → α → α/);
  });
  it("λx.x x → occurs check α = α → β", () => {
    expect(text("hm λx.x x")).toMatch(/occurs check — α = α → β at x x/);
  });
  it("λx.λy.x under hm / algorithm w / type scheme of → α → β → α, ∀α β. α → β → α; never 'Type: α'", () => {
    for (const s of ["hm λx.λy.x", "algorithm w λx.λy.x", "type scheme of λx.λy.x"]) {
      const r = hm(s);
      expect(`${s}: ${r.type} | ${r.scheme}`).toBe(`${s}: α → β → α | ∀α β. α → β → α`);
      expect(r.display).not.toContain("Type: α");
    }
  });
  it("let compose = … in compose → (α → β) → (γ → α) → γ → β, ∀α β γ", () => {
    const r = hm("hm let compose = λf.λg.λx.f (g x) in compose");
    expect(r.type).toBe("(α → β) → (γ → α) → γ → β");
    expect(r.scheme).toBe("∀α β γ. (α → β) → (γ → α) → γ → β");
  });
  it("let rec f = λx.f x in f → α → β, ∀α β. α → β (NOT 'not simply typable'), monomorphic recursion said", () => {
    const r = hm("hm let rec f = λx.f x in f");
    expect(r.type).toBe("α → β");
    expect(r.scheme).toBe("∀α β. α → β");
    expect(text("hm let rec f = λx.f x in f")).not.toMatch(/not simply typable/);
    expect(r.steps.join("\n")).toMatch(/monomorphic recursion/);
  });
  it("λf.(f 1, f true) → not typable: f is λ-bound, int ≠ bool at f true", () => {
    const t = text("hm λf.(f 1, f true)");
    expect(t).toMatch(/clash int ≠ bool at f true/);
    expect(t).toMatch(/f is λ-bound, hence MONOMORPHIC; write let f = … in … for polymorphism/);
  });
  it("if true then 1 else 2 → int; λx. if x then 1 else 0 → bool → int", () => {
    expect(hm("hm if true then 1 else 2").type).toBe("int");
    expect(hm("hm λx. if x then 1 else 0").type).toBe("bool → int");
  });
  it("type 1 is unchanged (the Church numeral) with the caveat naming the hm reading; hm 1 is int with the converse", () => {
    const t = hm("type 1");
    expect(t.type).toBe("(α → β) → α → β");
    expect(t.caveats.join(" ")).toMatch(/under hm, 1 : int/);
    const h = hm("hm 1");
    expect(h.type).toBe("int");
    expect(h.caveats.join(" ")).toMatch(/under type, 1 is the Church numeral/);
  });
  it("let id = λx.x ⏎ type PAIR (id 1) (id TRUE) → unchanged simple-type answer", () => {
    const r = hm("let id = λx.x\ntype PAIR (id 1) (id TRUE)");
    expect(r.title).toBe("Principal simple type");
    expect(r.type).toBe("(((α → β) → α → β) → (γ → δ → γ) → ε) → ε");
  });
  it("HM_RE reads the brief's spellings", () => {
    for (const s of ["hm x", "Hindley-Milner x", "hindley milner x", "algorithm w x", "w λx.x", "w (λx.x)", "w let id = λx.x in id", "type scheme x", "type scheme of x", "principal type scheme x", "infer scheme x"]) expect(`${s}: ${HM_RE.test(s)}`).toBe(`${s}: true`);
    // A bare w before anything else is a free variable (w x reduces).
    for (const s of ["type x", "what x", "wx", "hmm x", "w x", "w y z"]) expect(`${s}: ${HM_RE.test(s)}`).toBe(`${s}: false`);
  });
});

describe("display contract: every printed type and scheme re-parses through parseScheme", () => {
  const roundTrip = (line: string): void => {
    const names: string[] = [];
    const p = parseScheme(line, names);
    expect(showScheme({ vars: p.vars, ty: p.ty }, (id) => names[id])).toBe(line);
  };
  const cases = [
    "hm let id = λx.x in (id 1, id true)", "hm let id = λx.x in id id", "hm λf.λx.f (f x)", "hm λx.λy.x",
    "hm let compose = λf.λg.λx.f (g x) in compose", "hm let rec f = λx.f x in f", "hm λx. if x then 1 else 0",
    "hm λy. let f = λx.y in (f 1, f true)", "hm let x = 1 in let x = true in x", "hm fst (1, true)", "hm (λx.(x, (x, true))) 1",
    "hm λp.(snd p, fst p)", "hm PAIR",
  ];
  it.each(cases)("%s", (input) => {
    const r = hm(input);
    const lines: string[] = [];
    for (const d of r.display) {
      let m: RegExpExecArray | null;
      if ((m = /^Type: (.*)$/.exec(d))) lines.push(m[1]);
      else if ((m = /^Scheme: (.*?)(?: for \S+)?$/.exec(d))) lines.push(m[1]);
      else if ((m = /^\S+ : (.*) — no type variable to generalise/.exec(d))) lines.push(m[1]);
    }
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) roundTrip(l);
    // The Type: line and the term's own Scheme: line unify — each an instance of the other.
    if (r.scheme) {
      const names: string[] = [];
      const s = parseScheme(r.scheme, names);
      const t = parseScheme(r.type!, names);
      const allVars = (ty: HTy, out: number[] = []): number[] => {
        if (ty.k === "var") { if (!out.includes(ty.id)) out.push(ty.id); }
        else if (ty.k === "arrow") { allVars(ty.from, out); allVars(ty.to, out); }
        else if (ty.k === "pair") { allVars(ty.a, out); allVars(ty.b, out); }
        return out;
      };
      expect(isInstance({ vars: s.vars, ty: s.ty }, t.ty)).toBe(true);
      expect(isInstance({ vars: allVars(t.ty), ty: t.ty }, s.ty)).toBe(true);
    }
  });
  it("a scheme with a variable free in Γ prints it and dodges it: ∀β. β → α for f", () => {
    const r = hm("hm λy. let f = λx.y in (f 1, f true)");
    expect(r.type).toBe("α → α × α");
    expect(r.display).toContain("Scheme: ∀β. β → α for f");
    roundTrip("∀β. β → α");
  });
  it("parseScheme accepts ASCII spellings and → binds looser than ×", () => {
    const names: string[] = [];
    const a = parseScheme("forall a b. a * b -> a", names);
    expect(showScheme({ vars: a.vars, ty: a.ty }, (id) => names[id])).toBe("∀α β. α × β → α");
    const n2: string[] = [];
    const b = parseScheme("(α → β) × γ → int", n2);
    expect(showScheme({ vars: b.vars, ty: b.ty }, (id) => n2[id])).toBe("(α → β) × γ → int");
  });
});
