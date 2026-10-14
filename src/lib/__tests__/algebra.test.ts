/**
 * Abstract algebra — the acceptance audit from docs/SCOPE-ABSTRACT-ALGEBRA.md
 * §D. Every expected value there was computed independently of the engine
 * (the brief's own brute-force builder); each is pinned here as given.
 */
import { tryAlgebra, foldSubscripts, normalizeAlgebra, ALGEBRA_RE } from "../algebra";
import { DiscreteError, DiscreteResult } from "../discrete";
import {
  cyclicGroup, productGroup, symmetricGroup, alternatingGroup, dihedralGroup, quaternionGroup, dicyclicGroup, unitsGroup,
  orderStats, statsKey, catalogue, compareGroups, tableGroup, FiniteGroup, MAX_DECIDED_ORDER, op,
} from "../algebraGroups";

const timed = <T>(f: () => T): T => {
  const t0 = Date.now();
  const r = f();
  const dt = Date.now() - t0;
  if (dt > 1000) throw new Error(`took ${dt} ms`);
  return r;
};
const run = (q: string): DiscreteResult => {
  const r = timed(() => tryAlgebra(q));
  if (!r) throw new Error("not claimed: " + q);
  return r;
};
const disp = (q: string): string => run(q).display.join("\n");
const all = (q: string): string => { const r = run(q); return [r.title, ...r.display, ...r.steps, ...r.caveats].join("\n"); };
const refusal = (q: string): string => {
  try {
    const r = timed(() => tryAlgebra(q));
    throw new Error("answered, not refused: " + (r ? r.display.join(" / ") : "null"));
  } catch (err) {
    if (err instanceof DiscreteError) return err.message;
    throw err;
  }
};

describe("§D groups", () => {
  it("Z/6 → elements 0–5, cyclic (generators 1, 5), abelian, orders 1, 6, 3, 2, 3, 6; table drawn", () => {
    const r = run("Z/6");
    expect(r.display.join("\n")).toMatch(/\{0, 1, 2, 3, 4, 5\}/);
    expect(r.display.join("\n")).toMatch(/cyclic: yes — generators 1, 5/);
    expect(r.display.join("\n")).toMatch(/abelian: yes/);
    expect(r.steps.join("\n")).toMatch(/0: 1 · 1: 6 · 2: 3 · 3: 2 · 4: 3 · 5: 6/);
    expect(r.svg).toBeDefined();
    expect(r.title).toBe("Group ℤ/6ℤ (order 6, cyclic, abelian)");
  });
  it("ℤ/6ℤ, Z_6, Z6, Z/6Z, integers mod 6, group Z/6 → identical", () => {
    const base = disp("Z/6");
    for (const q of ["ℤ/6ℤ", "Z_6", "Z6", "Z/6Z", "integers mod 6", "group Z/6", "ℤ₆"]) expect(disp(q)).toBe(base);
  });
  it("U(8) → {1, 3, 5, 7}, orders 1, 2, 2, 2, NOT cyclic, ≅ ℤ/2ℤ × ℤ/2ℤ", () => {
    const t = all("U(8)");
    expect(t).toMatch(/U\(8\) = \{1, 3, 5, 7\}/);
    expect(t).toMatch(/1: 1 · 3: 2 · 5: 2 · 7: 2/);
    expect(t).toMatch(/cyclic: NO/);
    expect(t).toMatch(/U\(8\) ≅ ℤ\/2ℤ × ℤ\/2ℤ/);
  });
  it("is U(8) cyclic? → NO, no element of order 4", () => {
    expect(disp("is U(8) cyclic?")).toMatch(/U\(8\) is NOT cyclic: its elements 1, 3, 5, 7 have orders 1, 2, 2, 2 — none has order 4/);
    expect(disp("is U(8) cyclic?")).toMatch(/no element of order 4/);
  });
  it("U(10) / is U(10) cyclic → {1, 3, 7, 9}, orders 1, 4, 4, 2, cyclic, generators 3, 7, ≅ ℤ/4ℤ", () => {
    const t = all("U(10)");
    expect(t).toMatch(/\{1, 3, 7, 9\}/);
    expect(t).toMatch(/1: 1 · 3: 4 · 7: 4 · 9: 2/);
    expect(t).toMatch(/generators 3, 7/);
    expect(t).toMatch(/≅ ℤ\/4ℤ/);
    expect(disp("is U(10) cyclic")).toMatch(/U\(10\) is cyclic: generators 3, 7 \(3¹ = 3, 3² = 9, 3³ = 7, 3⁴ = 1\)\. U\(10\) ≅ ℤ\/4ℤ\./);
  });
  it("is 3 a generator of U(10) → yes (3, 9, 7, 1)", () => {
    expect(disp("is 3 a generator of U(10)")).toMatch(/^yes — .*\(3, 9, 7, 1\)/);
  });
  it("U(12) → {1, 5, 7, 11}, all order ≤ 2, not cyclic; order of 5 in U(12) → 2", () => {
    const t = all("U(12)");
    expect(t).toMatch(/\{1, 5, 7, 11\}/);
    expect(t).toMatch(/every element has order ≤ 2/);
    expect(t).toMatch(/cyclic: NO/);
    expect(disp("order of 5 in U(12)")).toMatch(/order of 5 in U\(12\) = 2/);
  });
  it("S3 / S_3 / Sym(3) → 6 elements, non-abelian (witness (1 2)(1 3) = (1 3 2) ≠ (1 3)(1 2) = (1 2 3)), orders 1, 2, 2, 2, 3, 3", () => {
    for (const q of ["S3", "S_3", "Sym(3)", "S₃"]) {
      const t = all(q);
      expect(t).toMatch(/S₃ = \{e, \(1 2\), \(1 3\), \(2 3\), \(1 2 3\), \(1 3 2\)\}/);
      expect(t).toMatch(/\(1 2\)\(1 3\) = \(1 3 2\), \(1 3\)\(1 2\) = \(1 2 3\)/);
      expect(t).toMatch(/e: 1 · \(1 2\): 2 · \(1 3\): 2 · \(2 3\): 2 · \(1 2 3\): 3 · \(1 3 2\): 3/);
    }
  });
  it("D4 → order 8, orders 1, 4, 2, 4, 2, 2, 2, 2, non-abelian, Z = {e, r²}; derangement caveat", () => {
    const r = run("D4");
    const t = all("D4");
    expect(r.title).toMatch(/order 8/);
    expect(t).toMatch(/e: 1 · r: 4 · r²: 2 · r³: 4 · s: 2 · rs: 2 · r²s: 2 · r³s: 2/);
    expect(t).toMatch(/abelian: NO/);
    expect(t).toMatch(/Z\(D₄\) = \{e, r²\}/);
    expect(r.caveats.join(" ")).toMatch(/D4 read as the symmetries of the square.*derangements: write derangements 4/);
  });
  it("D_8 → order 16 with the convention note", () => {
    const r = run("D_8");
    expect(r.title).toMatch(/order 16/);
    expect(r.caveats.join(" ")).toMatch(/D_8 read as the symmetries of the octagon \(order 16\).*the two conventions differ/);
  });
  it("Z/2 x Z/4 / Z/2 × Z/4 → order 8, abelian, not cyclic (orders 1; 2 ×3; 4 ×4)", () => {
    for (const q of ["Z/2 x Z/4", "Z/2 × Z/4"]) {
      const r = run(q);
      expect(r.title).toBe("Group ℤ/2ℤ × ℤ/4ℤ (order 8, abelian)");
      const orders = r.steps.find((s) => s.startsWith("Order of each element"))!;
      expect((orders.match(/: 1(?= ·|$)/g) ?? []).length).toBe(1);
      expect((orders.match(/: 2(?= ·|$)/g) ?? []).length).toBe(3);
      expect((orders.match(/: 4(?= ·|$)/g) ?? []).length).toBe(4);
      expect(r.display.join(" ")).toMatch(/cyclic: NO/);
    }
  });
  it("klein four group → V₄ ≅ ℤ/2ℤ × ℤ/2ℤ", () => {
    expect(disp("klein four group")).toMatch(/V₄ ≅ ℤ\/2ℤ × ℤ\/2ℤ/);
  });
  it("cayley table of S3 → 6 × 6 grid drawn, text table printed", () => {
    const r = run("cayley table of S3");
    expect(r.svg).toBeDefined();
    expect(r.display.length).toBe(7);
    expect(r.display[0]).toBe("· | e | (1 2) | (1 3) | (2 3) | (1 2 3) | (1 3 2)");
  });
  it("cayley table of U(8) → 4 × 4, symmetric (abelian visible)", () => {
    const r = run("cayley table of U(8)");
    expect(r.display.length).toBe(5);
    expect(r.steps.join(" ")).toMatch(/symmetric about its diagonal/);
  });
  it("multiplication table of Z/5 → 5 × 5 including the 0 row, note on U(5)", () => {
    const r = run("multiplication table of Z/5");
    expect(r.display).toContain("0: 0 | 0 | 0 | 0 | 0");
    expect(r.steps.join(" ")).toMatch(/U\(5\) = \{1, 2, 3, 4\}/);
    expect(r.svg).toBeDefined();
  });
  it("group with cayley table e a b / a b e / b e a → a group of order 3 ≅ ℤ/3ℤ (axioms checked)", () => {
    expect(disp("group with cayley table\ne a b\na b e\nb e a")).toMatch(/a group of order 3 ≅ ℤ\/3ℤ \(axioms checked\)/);
  });
  it("a table with a·a = a, a ≠ e → refused naming the failing axiom (no inverse for a)", () => {
    expect(refusal("group with cayley table\ne a\na a")).toMatch(/No inverse for a/);
  });
  it("order of 2 in Z/6 → 3", () => {
    expect(disp("order of 2 in Z/6")).toBe("order of 2 in ℤ/6ℤ = 3 (2, 4, 0)");
  });
  it("orders of all elements of Z/12", () => {
    expect(disp("orders of all elements of Z/12")).toMatch(/order 1: 0 · order 2: 6 · order 3: 4, 8 · order 4: 3, 9 · order 6: 2, 10 · order 12: 1, 5, 7, 11/);
  });
  it("elements of order 2 in D4 → s, rs, r², r²s, r³s (five)", () => {
    const d = disp("elements of order 2 in D4");
    const els = d.replace(/ \(5\)$/, "").split(", ");
    expect(new Set(els)).toEqual(new Set(["s", "rs", "r²", "r²s", "r³s"]));
  });
  it("subgroup generated by 4 in Z/12 / <4> in Z/12 → ⟨4⟩ = {0, 4, 8}, order 3, index 4", () => {
    expect(disp("subgroup generated by 4 in Z/12")).toBe("⟨4⟩ = {0, 4, 8}, order 3, index 4");
    expect(disp("<4> in Z/12")).toBe("⟨4⟩ = {0, 4, 8}, order 3, index 4");
    expect(disp("⟨4⟩ in ℤ/12ℤ")).toBe("⟨4⟩ = {0, 4, 8}, order 3, index 4");
  });
  it("<(1 2), (1 2 3)> in S3 → the whole group", () => {
    expect(disp("<(1 2), (1 2 3)> in S3")).toMatch(/= S₃ \(the whole group\)/);
  });
  it("subgroups of Z/12 → 6, one per divisor", () => {
    const d = disp("subgroups of Z/12");
    for (const s of ["{0}", "{0, 6}", "{0, 4, 8}", "{0, 3, 6, 9}", "{0, 2, 4, 6, 8, 10}", "ℤ/12ℤ"]) expect(d).toContain(s);
    expect(d).toMatch(/6 subgroups — one for each divisor of 12/);
  });
  it("subgroup lattice of Z/12 → Hasse edges 1–2, 1–3, 2–4, 2–6, 3–6, 4–12, 6–12; trivial below G", () => {
    const r = run("subgroup lattice of Z/12");
    const edges = /Covering relations \(by order\): ([^.]+)\./.exec(r.steps.join("\n"))![1].split(", ").sort();
    expect(edges).toEqual(["1–2", "1–3", "2–4", "2–6", "3–6", "4–12", "6–12"].sort());
    const svg = r.svg!;
    const yOf = (label: string): number => {
      const m = new RegExp(`<text[^>]*y="([\\d.]+)"[^>]*>${label.replace(/[(){}/[\]]/g, (c) => "\\" + c)}</text>`).exec(svg);
      return m ? Number(m[1]) : NaN;
    };
    expect(yOf("{0}")).toBeGreaterThan(yOf("ℤ/12ℤ"));
  });
  it("all subgroups of S3 → 6, A₃ named", () => {
    const d = disp("all subgroups of S3");
    for (const s of ["{e}", "{e, (1 2)}", "{e, (1 3)}", "{e, (2 3)}", "{e, (1 2 3), (1 3 2)} = A₃", "S₃"]) expect(d).toContain(s);
    expect(d).toMatch(/6 subgroups/);
  });
  it("subgroups of D4 → 10", () => {
    expect(disp("subgroups of D4")).toMatch(/10 subgroups/);
  });
  it("lagrange: subgroups of order 4 in Z/12 → {0, 3, 6, 9} only", () => {
    const d = disp("lagrange: subgroups of order 4 in Z/12");
    expect(d).toMatch(/\{0, 3, 6, 9\}/);
    expect(d).toMatch(/\(1\)/);
    expect(d).not.toMatch(/interpolate/);
  });
  it("subgroups of order 5 in Z/12 → none, 5 ∤ 12", () => {
    expect(disp("subgroups of order 5 in Z/12")).toBe("none — 5 does not divide 12 (Lagrange)");
  });
  it("subgroups of S6 → refused by name (720 > 120) before any work", () => {
    expect(refusal("subgroups of S6")).toMatch(/S₆ has order 720 — above the cap \|G\| ≤ 120/);
  });
  it("generators of Z/12 → 1, 5, 7, 11 (φ(12) = 4)", () => {
    expect(disp("generators of Z/12")).toBe("1, 5, 7, 11 — φ(12) = 4 generators");
  });
  it("cosets of <3> in Z/12 → {0, 3, 6, 9}, {1, 4, 7, 10}, {2, 5, 8, 11}; 12 = 4 · 3", () => {
    const d = disp("cosets of <3> in Z/12");
    for (const s of ["{0, 3, 6, 9}", "{1, 4, 7, 10}", "{2, 5, 8, 11}", "12 = 4 · 3"]) expect(d).toContain(s);
  });
  it("left / right cosets of {e, (1 2)} in S3; they differ, so H is not normal", () => {
    const l = disp("left cosets of {e, (1 2)} in S3");
    expect(l).toContain("H = {e, (1 2)}");
    expect(l).toContain("(1 3)H = {(1 3), (1 2 3)}");
    expect(l).toContain("(2 3)H = {(2 3), (1 3 2)}");
    const r = disp("right cosets of {e, (1 2)} in S3");
    expect(r).toContain("H(1 3) = {(1 3), (1 3 2)}");
    expect(r).toContain("H(2 3) = {(2 3), (1 2 3)}");
    expect(l).toMatch(/differ.*H is not normal/);
  });
  it("is {e, (1 2)} normal in S3 → NOT normal, witness (1 3)(1 2)(1 3) = (2 3) ∉ H", () => {
    expect(disp("is {e, (1 2)} normal in S3")).toBe("NOT normal: (1 3)(1 2)(1 3)⁻¹ = (2 3) ∉ H");
  });
  it("is A3 normal in S3 → normal (index 2)", () => {
    expect(disp("is A3 normal in S3")).toMatch(/^normal: index 2/);
  });
  it("quotient Z/12 / <4> / Z/12 / <4> → cosets; ≅ ℤ/4ℤ, table drawn", () => {
    for (const q of ["quotient Z/12 / <4>", "Z/12 / <4>"]) {
      const r = run(q);
      expect(r.display[0]).toBe("elements (cosets): {0, 4, 8}, {1, 5, 9}, {2, 6, 10}, {3, 7, 11}");
      expect(r.display[1]).toMatch(/ℤ\/12ℤ \/ ⟨4⟩ ≅ ℤ\/4ℤ \(order 4, cyclic: generated by 1 \+ ⟨4⟩\)/);
      expect(r.svg).toBeDefined();
    }
  });
  it("S3 / A3 → ≅ ℤ/2ℤ; S3 / {e, (1 2)} → refused: not normal", () => {
    expect(disp("S3 / A3")).toMatch(/≅ ℤ\/2ℤ/);
    expect(refusal("S3 / {e, (1 2)}")).toMatch(/not normal/);
  });
  it("D4 / <r^2> ≅ ℤ/2ℤ × ℤ/2ℤ", () => {
    expect(disp("D4 / <r^2>")).toMatch(/D₄ \/ ⟨r²⟩ ≅ ℤ\/2ℤ × ℤ\/2ℤ/);
  });
  it("center of D4 → {e, r²}; center of S3 → {e}", () => {
    expect(disp("center of D4")).toBe("Z(D₄) = {e, r²}");
    expect(disp("center of S3")).toBe("Z(S₃) = {e} (trivial)");
  });
  it("conjugacy classes of S3 → {e}, {(1 2), (1 3), (2 3)}, {(1 2 3), (1 3 2)}; 6 = 1 + 3 + 2", () => {
    const d = disp("conjugacy classes of S3");
    expect(d).toContain("{e} (size 1)");
    expect(d).toContain("{(1 2), (1 3), (2 3)} (size 3)");
    expect(d).toContain("{(1 2 3), (1 3 2)} (size 2)");
    expect(d).toContain("6 = 1 + 3 + 2");
  });
  it("conjugacy classes of S4 → sizes 1, 6, 3, 8, 6 by cycle type", () => {
    const t = all("conjugacy classes of S4");
    expect(t).toContain("24 = 1 + 6 + 3 + 8 + 6");
    expect(t).toContain("S₄: 1 + 6 + 3 + 8 + 6 = 24 — classes by cycle type: e · (a b) · (a b)(c d) · (a b c) · (a b c d)");
  });
  it("is Z/8 isomorphic to Z/2 x Z/4 (both spellings) → NOT: 4 elements of order 8 vs none; statistics 1,1,2,4 vs 1,3,4", () => {
    for (const q of ["is Z/8 isomorphic to Z/2 x Z/4", "is (Z/8, +) ≅ (Z/2 × Z/4, +)?"]) {
      const t = all(q);
      expect(t).toMatch(/NOT isomorphic/);
      expect(t).toMatch(/ℤ\/8ℤ has 4 elements of order 8 and ℤ\/2ℤ × ℤ\/4ℤ has none/);
      expect(t).toMatch(/ℤ\/8ℤ: orders 1, 2, 4, 8 occur 1, 1, 2, 4 times/);
      expect(t).toMatch(/ℤ\/2ℤ × ℤ\/4ℤ: orders 1, 2, 4 occur 1, 3, 4 times/);
    }
  });
  it("Z/2 x Z/3 vs Z/6 (three spellings) → isomorphic (gcd(2, 3) = 1; CRT map printed)", () => {
    for (const q of ["is Z/2 x Z/3 isomorphic to Z/6", "Z/6 ≅ Z/2 × Z/3", "Z/6 ≅ Z/2 x Z/3?"]) {
      const d = disp(q);
      expect(d).toMatch(/gcd\(2, 3\) = 1, so ℤ\/6ℤ ≅ ℤ\/2ℤ × ℤ\/3ℤ/);
      expect(d).toContain("0 ↦ (0, 0), 1 ↦ (1, 1), 2 ↦ (0, 2), 3 ↦ (1, 0), 4 ↦ (0, 1), 5 ↦ (1, 2)");
    }
  });
  it("chinese remainder Z/6 ≅ Z/2 × Z/3 → the explicit table and the inverse (1, 2) ↦ 5", () => {
    const d = disp("chinese remainder Z/6 ≅ Z/2 × Z/3");
    expect(d).toContain("0 ↦ (0, 0), 1 ↦ (1, 1), 2 ↦ (0, 2), 3 ↦ (1, 0), 4 ↦ (0, 1), 5 ↦ (1, 2)");
    expect(d).toContain("(1, 2) ↦ 5");
  });
  it("Z/4 ≅ Z/2 x Z/2? → NOT", () => {
    expect(disp("Z/4 ≅ Z/2 x Z/2?")).toMatch(/^NOT isomorphic: gcd\(2, 2\) = 2 — ℤ\/4ℤ has 2 elements of order 4 and ℤ\/2ℤ × ℤ\/2ℤ has none/);
  });
  it("isomorphism type of U(8) → ℤ/2ℤ × ℤ/2ℤ (invariant factors 2, 2)", () => {
    expect(disp("isomorphism type of U(8)")).toMatch(/ℤ\/2ℤ × ℤ\/2ℤ.*invariant factors 2, 2/);
  });
  it("isomorphism type of D4 → D₄ (order 8, non-abelian, 5 elements of order 2 — Q₈ has 1): decided, |G| ≤ 15", () => {
    expect(disp("isomorphism type of D4")).toBe("isomorphism type: D₄ (order 8, non-abelian, 5 elements of order 2 — Q₈ has 1): decided, |G| ≤ 15");
  });
  it("is Z/6 x Z/4 isomorphic to Z/2 x Z/12 → isomorphic (invariant factors 2, 12)", () => {
    expect(disp("is Z/6 x Z/4 isomorphic to Z/2 x Z/12")).toMatch(/isomorphic: both abelian with invariant factors 2, 12/);
  });
  it("find all groups of order 6 → ℤ/6ℤ, S₃; order 16 refused by name", () => {
    expect(disp("find all groups of order 6")).toMatch(/two: ℤ\/6ℤ and S₃\norder statistics 1,1,2,2 vs 1,3,2/);
    expect(refusal("find all groups of order 16")).toMatch(/14 of them.*beyond the built-in list/);
  });
  it("is D4 abelian → no, rs ≠ sr; is Z/2 x Z/2 abelian → yes", () => {
    expect(disp("is D4 abelian")).toBe("no — rs ≠ sr: rs = rs, sr = r³s");
    expect(disp("is Z/2 x Z/2 abelian")).toMatch(/^yes/);
  });
  it("a^2 = e, b^3 = e and a * b = e → the presentation refusal by name", () => {
    for (const q of ["a^2 = e, b^3 = e", "a * b = e"]) expect(refusal(q)).toMatch(/Group presentations .* are not read/);
  });
});

describe("§D permutations", () => {
  it("(1 2 3)(4 5) → disjoint already; order 6, odd, sign −1, cycle type [3, 2], two-row 2 3 1 5 4, diagram drawn", () => {
    const r = run("(1 2 3)(4 5)");
    const d = r.display.join("\n");
    expect(d).toMatch(/already a product of disjoint cycles/);
    expect(d).toMatch(/order 6 = lcm\(3, 2\), odd \(3 transpositions: \(1 3\)\(1 2\)\(4 5\)\), sign −1, cycle type \[3, 2\]/);
    expect(d).toContain("two-row form: 1 2 3 4 5 / 2 3 1 5 4");
    expect(r.svg).toBeDefined();
  });
  it("(1 2 3)(1 2) / (1 2 3) * (1 2) / compose … → (1 3), right to left; left to right gives (2 3)", () => {
    for (const q of ["(1 2 3)(1 2)", "(1 2 3) * (1 2)", "compose (1 2 3) and (1 2)", "(1 2 3) ∘ (1 2)"]) {
      const d = disp(q);
      expect(d).toMatch(/= \(1 3\)/);
      expect(d).toMatch(/composed right to left: \(1 2\) is applied first — left to right would give \(2 3\)/);
    }
  });
  it("(1 2 3)(1 2) left to right → (2 3)", () => {
    expect(disp("(1 2 3)(1 2) left to right")).toMatch(/= \(2 3\)/);
  });
  it("the convention note appears exactly when the two readings differ", () => {
    expect(disp("(1 2)(3 4)")).toMatch(/the other order gives the same permutation/);
    expect(disp("(1 2)(3 4)")).not.toMatch(/would give/);
  });
  it("inverse of (1 2 3 4) → (1 4 3 2)", () => {
    expect(disp("inverse of (1 2 3 4)")).toMatch(/^inverse of \(1 2 3 4\) = \(1 4 3 2\)/);
  });
  it("(1 2 3 4)^2 → (1 3)(2 4)", () => {
    expect(disp("(1 2 3 4)^2")).toMatch(/^\(1 2 3 4\)\^2 = \(1 3\)\(2 4\)/);
  });
  it("sign / parity / cycle type / order", () => {
    expect(disp("sign of (1 2 3)(4 5)")).toMatch(/^sign of \(1 2 3\)\(4 5\) = −1 — odd \(3 transpositions/);
    expect(disp("parity of (1 2)(3 4)")).toMatch(/^\(1 2\)\(3 4\) is even, sign \+1/);
    expect(disp("cycle type of (1 2 3)(4 5)")).toMatch(/^cycle type of \(1 2 3\)\(4 5\) = \[3, 2\]/);
    expect(disp("order of (1 2 3)(4 5)")).toMatch(/^order of \(1 2 3\)\(4 5\) = 6 = lcm\(3, 2\)/);
  });
  it("permutation 2 3 1 / [2 3 1] → (1 2 3)", () => {
    expect(run("permutation 2 3 1").display[0]).toBe("(1 2 3)");
    expect(run("[2 3 1]").display[0]).toBe("(1 2 3)");
    expect(run("1 2 3 / 2 3 1").display[0]).toBe("(1 2 3)");
  });
  it("(12)(34) → (1 2)(3 4) with the digit-per-point note", () => {
    const r = run("(12)(34)");
    expect(r.display[0]).toMatch(/^\(1 2\)\(3 4\)/);
    expect(r.caveats.join(" ")).toMatch(/\(12\) read as the transposition of 1 and 2, one digit per point; for points ≥ 10 write spaces or commas/);
  });
  it("cycle diagram of (1 2 3 4 5 6) → one 6-cycle drawn, order 6", () => {
    const r = run("cycle diagram of (1 2 3 4 5 6)");
    expect(r.svg).toBeDefined();
    expect(r.display.join(" ")).toMatch(/order 6/);
    expect(r.display.join(" ")).toMatch(/cycle type \[6\]/);
  });
  it("sigma = (1 2 3), tau = (1 2), sigma * tau → (1 3), never sigma = 6", () => {
    const d = disp("sigma = (1 2 3), tau = (1 2), sigma * tau");
    expect(d).toMatch(/= \(1 3\)/);
    expect(d).not.toMatch(/= 6/);
  });
  it("(1 2 3)(4 5) in S4 → refused: 5 is not a point of S₄", () => {
    expect(refusal("(1 2 3)(4 5) in S4")).toMatch(/5 is not a point of S₄/);
  });
});

describe("§D rings", () => {
  it("7 * 9 mod 12 / 7*9 mod 12 → 3", () => {
    for (const q of ["7 * 9 mod 12", "7*9 mod 12"]) {
      expect(disp(q)).toBe("7 · 9 ≡ 3 (mod 12)");
      expect(run(q).steps[0]).toBe("7 · 9 = 63 = 5 · 12 + 3, so 7 · 9 ≡ 3 (mod 12)");
    }
  });
  it("7 + 9 mod 12 / in Z/12: 7 + 9 → 4", () => {
    expect(disp("7 + 9 mod 12")).toBe("7 + 9 ≡ 4 (mod 12)");
    expect(disp("in Z/12: 7 + 9")).toBe("7 + 9 ≡ 4 (mod 12)");
  });
  it("3 * 5 = 1 mod 7 → TRUE (15 ≡ 1)", () => {
    expect(disp("3 * 5 = 1 mod 7")).toBe("3 · 5 = 15 ≡ 1 (mod 7): TRUE");
  });
  it("inverse of 5 in Z/12 / 5^-1 in Z/12 → 5; inverse of 3 in Z/7 → 5; inverse of 4 in Z/12 → none", () => {
    expect(run("inverse of 5 in Z/12").display[0]).toBe("inverse of 5 in ℤ/12ℤ = 5 (5 · 5 = 25 ≡ 1)");
    expect(run("5^-1 in Z/12").display[0]).toBe("inverse of 5 in ℤ/12ℤ = 5 (5 · 5 = 25 ≡ 1)");
    expect(run("inverse of 3 in Z/7").display[0]).toBe("inverse of 3 in ℤ/7ℤ = 5 (3 · 5 = 15 ≡ 1)");
    expect(disp("inverse of 4 in Z/12")).toMatch(/^none: gcd\(4, 12\) = 4/);
  });
  it("units / zero divisors / is 5 a unit", () => {
    expect(run("units of Z/12").display[0]).toBe("units of ℤ/12ℤ = {1, 5, 7, 11} (φ(12) = 4)");
    expect(disp("units of Z/12")).toMatch(/U\(12\) ≅ ℤ\/2ℤ × ℤ\/2ℤ/);
    expect(disp("zero divisors of Z/12")).toBe("zero divisors of ℤ/12ℤ = {2, 3, 4, 6, 8, 9, 10}");
    expect(run("zero divisors of Z/12").steps[0]).toMatch(/2 · 6 = 12 ≡ 0/);
    expect(disp("is 5 a unit in Z/12")).toMatch(/^yes/);
  });
  it("is Z/7 a field → yes (prime); is Z/6 a field → no (2 · 3 ≡ 0)", () => {
    expect(disp("is Z/7 a field")).toBe("ℤ/7ℤ is a field (7 is prime: every nonzero element has an inverse — 1, 4, 5, 2, 3, 6)");
    expect(disp("is Z/6 a field")).toBe("ℤ/6ℤ is NOT a field: 2 · 3 ≡ 0, a zero divisor, so 2 has no inverse");
  });
  it("solve 3x = 2 in Z/7 → x = 3; x^2 + 1 = 0 in Z/5 → x = 2, 3; x^2 + 1 = 0 mod 3 → no solution", () => {
    expect(disp("solve 3x = 2 in Z/7")).toMatch(/x ≡ 3 \(mod 7\)/);
    expect(disp("x^2 + 1 = 0 in Z/5")).toMatch(/^x = 2, 3 /);
    expect(disp("x^2 + 1 = 0 mod 3")).toMatch(/^no solution/);
  });
  it("unchanged number theory → null here (pinned both ways in algebraRouting.test.ts)", () => {
    for (const q of ["order of 3 mod 7", "primitive roots mod 10", "inverse 5 mod 12", "7^100 mod 13", "3^-1 mod 7", "x^2 = 2 mod 7", "17 mod 5"]) expect(tryAlgebra(q)).toBeNull();
  });
});

describe("§D 𝔽p[x] and GF(q)", () => {
  it("(x^2 + 1)(x + 2) mod 3 / over F_3 → x³ + 2x² + x + 2", () => {
    for (const q of ["(x^2 + 1)(x + 2) mod 3", "(x^2 + 1)(x + 2) over F_3"]) expect(run(q).display[0]).toMatch(/= x\^3 \+ 2x\^2 \+ x \+ 2 over 𝔽₃/);
  });
  it("x^2 + 1 mod 3 → already reduced, irreducible, no roots", () => {
    const d = disp("x^2 + 1 mod 3");
    expect(d).toMatch(/x\^2 \+ 1 is already reduced over 𝔽₃/);
    expect(d).toMatch(/it has no roots \(0² \+ 1 = 1, 1² \+ 1 = 2, 2² \+ 1 = 2\), so it is irreducible of degree 2/);
  });
  it("irreducibility over F_3 / F_2", () => {
    expect(disp("is x^2 + 1 irreducible over F_3")).toMatch(/^yes/);
    expect(disp("is x^2 + 1 irreducible over F_2")).toBe("no: x^2 + 1 = (x + 1)^2");
  });
  it("factorisations over 𝔽₂ and 𝔽₃", () => {
    expect(disp("factor x^2 + 1 over F_2")).toBe("x^2 + 1 = (x + 1)^2 over 𝔽₂");
    expect(disp("factor x^4 + x + 1 over F_2")).toBe("x^4 + x + 1 is irreducible over 𝔽₂");
    expect(disp("factor x^3 + x + 1 over F_2")).toBe("x^3 + x + 1 is irreducible over 𝔽₂");
    expect(disp("factor x^4 + x^2 + 1 over F_2")).toBe("x^4 + x^2 + 1 = (x^2 + x + 1)^2 over 𝔽₂");
    expect(disp("factor x^2 + 2 over F_3")).toBe("x^2 + 2 = (x + 1)(x + 2) over 𝔽₃");
    expect(disp("factor x^3 + x^2 + 1 over F_3")).toBe("x^3 + x^2 + 1 = (x + 2)(x^2 + 2x + 2) over 𝔽₃");
  });
  it("the AES polynomial is irreducible (trial division, 2⁴ candidates)", () => {
    const r = run("factor x^8 + x^4 + x^3 + x + 1 over F_2");
    expect(r.display[0]).toBe("x^8 + x^4 + x^3 + x + 1 is irreducible over 𝔽₂");
  });
  it("irreducible polynomials of degree 2 over F_2 / F_3", () => {
    expect(disp("irreducible polynomials of degree 2 over F_2")).toBe("x^2 + x + 1 (one)");
    expect(disp("irreducible polynomials of degree 2 over F_3")).toBe("x^2 + 1, x^2 + x + 2, x^2 + 2x + 2 (3)");
  });
  it("gcd and extended Euclid over 𝔽₂", () => {
    const g = disp("gcd of x^3 + 1 and x^2 + 1 over F_2");
    expect(g).toMatch(/gcd\(x\^3 \+ 1, x\^2 \+ 1\) = x \+ 1 over 𝔽₂/);
    expect(g).toMatch(/x \+ 1 = \(x\^3 \+ 1\) \+ \(x\)·\(x\^2 \+ 1\)/);
    expect(disp("extended euclid x^3 + x + 1, x^2 + 1 over F_2")).toBe("gcd = 1; 1 = (x^3 + x + 1) + (x)·(x^2 + 1)");
  });
  it("x^2 + x + 1 = 0 in F_2 → no roots in 𝔽₂ (roots live in 𝔽₄)", () => {
    expect(disp("x^2 + x + 1 = 0 in F_2")).toMatch(/^no solution in 𝔽₂.*roots live in 𝔽₄/);
  });
  it("factor x^2 + 1 over Z/6 → refused by name; factor x^2 + 1 (no field) → not claimed (ℚ behaviour unchanged)", () => {
    expect(refusal("factor x^2 + 1 over Z/6")).toMatch(/ℤ\/6ℤ is not a field/);
    expect(tryAlgebra("factor x^2 + 1")).toBeNull();
  });
  it("GF(9) / F_9 = F_3[x]/(x^2 + 1) → 𝔽₃[x]/(x² + 1), orders, primitive elements, table drawn", () => {
    for (const q of ["GF(9)", "F_9 = F_3[x]/(x^2 + 1)", "𝔽₉"]) {
      const r = run(q);
      const t = all(q);
      expect(r.display[0]).toMatch(/^𝔽₉ = 𝔽₃\[x\]\/\(x² \+ 1\), a = the class of x, a² = 2/);
      expect(t).toMatch(/0, 1, 2, a, a \+ 1, a \+ 2, 2a, 2a \+ 1, 2a \+ 2/);
      expect(t).toMatch(/2: 2 · a: 4 · a \+ 1: 8 · a \+ 2: 8 · 2a: 4 · 2a \+ 1: 8 · 2a \+ 2: 8/);
      expect(t).toMatch(/primitive elements \(order 8\): a \+ 1, a \+ 2, 2a \+ 1, 2a \+ 2 — a itself is NOT primitive \(order 4\)/);
      expect(r.svg).toBeDefined();
    }
  });
  it("primitive element of GF(9) → a + 1 (order 8), a is not (order 4)", () => {
    expect(disp("primitive element of GF(9)")).toBe("a + 1 (order 8); a is not (order 4)");
  });
  it("GF(4) / F_4 multiplication table → 𝔽₂[x]/(x² + x + 1), the four rows", () => {
    expect(run("GF(4)").display[0]).toMatch(/^𝔽₄ = 𝔽₂\[x\]\/\(x² \+ x \+ 1\)/);
    const d = disp("F_4 multiplication table");
    for (const row of ["0: 0 | 0 | 0 | 0", "1: 0 | 1 | a | a + 1", "a: 0 | a | a + 1 | 1", "a + 1: 0 | a + 1 | 1 | a"]) expect(d).toContain(row);
  });
  it("elements of GF(8) → 𝔽₂[x]/(x³ + x + 1), 8 elements, every nonzero element primitive", () => {
    const d = disp("elements of GF(8)");
    expect(d).toMatch(/𝔽₈ = 𝔽₂\[x\]\/\(x³ \+ x \+ 1\)/);
    expect(d).toMatch(/8 elements/);
    // §D says "every nonzero element of order 7"; 1 has order 1, so the true statement excludes it.
    expect(d).toMatch(/every nonzero element except 1 has order 7 \(primitive\)/);
  });
  it("minimal polynomial of a^3 in GF(8) → x³ + x² + 1, conjugates a + 1, a² + 1, a² + a + 1", () => {
    const d = disp("minimal polynomial of a^3 in GF(8)");
    expect(d).toMatch(/minimal polynomial of a\^3 = x\^3 \+ x\^2 \+ 1/);
    expect(d).toMatch(/a\^3 = a \+ 1, \(a\^3\)\^2 = a\^2 \+ 1, \(a\^3\)\^4 = a\^2 \+ a \+ 1/);
  });
  it("(a + 1)(2a + 2) in GF(9) → a", () => {
    expect(disp("(a + 1)(2a + 2) in GF(9)")).toBe("(a + 1)(2a + 2) = a in GF(9)");
  });
  it("GF(6) → not a prime power; GF(2^11) → refused (2048 > 1024)", () => {
    expect(refusal("GF(6)")).toMatch(/6 is not a prime power — there is no field with 6 elements/);
    expect(refusal("GF(2^11)")).toMatch(/2,048 elements — above the cap q ≤ 1024/);
  });
});

describe("§B homomorphisms and extras", () => {
  it("is f(x) = 2x a homomorphism from Z/4 to Z/8 → yes, ker {0}, im {0, 2, 4, 6} ≅ ℤ/4ℤ", () => {
    const d = disp("is f(x) = 2x a homomorphism from Z/4 to Z/8");
    expect(d).toMatch(/^yes/);
    expect(d).toContain("ker f = {0}");
    expect(d).toContain("im f = {0, 2, 4, 6} ≅ ℤ/4ℤ");
  });
  it("kernel of x -> 2x from Z/6 to Z/6 → {0, 3}", () => {
    expect(run("kernel of x -> 2x from Z/6 to Z/6").display[0]).toBe("ker f = {0, 3}");
  });
  it("x -> 3x from Z/4 to Z/6 IS well defined (3·4 = 12 ≡ 0 in ℤ/6ℤ) — the brief's §B example says otherwise; the mathematics decides", () => {
    const d = disp("is x -> 3x a homomorphism from Z/4 to Z/6");
    expect(d).toMatch(/^yes/);
    expect(d).toContain("ker f = {0, 2}");
  });
  it("x -> x + 1 is not a homomorphism: f(0) = 1 ≠ 0", () => {
    expect(disp("is x -> x + 1 a homomorphism from Z/4 to Z/4")).toMatch(/NOT a homomorphism: f\(0\) = 1 ≠ 0/);
  });
  it("x -> 2x from Z/3 to Z/4 is not well defined", () => {
    expect(disp("is x -> 2x a homomorphism from Z/3 to Z/4")).toMatch(/NOT well defined/);
  });
  it("aut(Z/8) is stated, not computed", () => {
    expect(disp("aut(Z/8)")).toMatch(/Aut\(ℤ\/8ℤ\) ≅ U\(8\) — stated, not computed/);
  });
  it("D_8 of order 8 reads the square", () => {
    expect(run("D_8 of order 8").title).toMatch(/D₄ \(order 8/);
  });
});

describe("the |G| ≤ 15 completeness claim is PROVEN here, and fails at 16", () => {
  it("every group of each order ≤ 15 (built from the constructors) has distinct order statistics", () => {
    for (let n = 1; n <= MAX_DECIDED_ORDER; n++) {
      const keys = catalogue(n).map((c) => statsKey(orderStats(c.build())));
      expect(new Set(keys).size).toBe(keys.length);
    }
    // The catalogue sizes are the known group counts.
    const counts = [0, 1, 1, 1, 2, 1, 2, 1, 5, 2, 2, 1, 5, 1, 2, 1];
    for (let n = 1; n <= 15; n++) expect(catalogue(n).length).toBe(counts[n]);
  });
  it("order 16: ℤ/8ℤ × ℤ/2ℤ and M₁₆ share order statistics, so 16 is NOT decided", () => {
    const A = productGroup([cyclicGroup(8), cyclicGroup(2)]);
    // M₁₆ = ℤ/8 ⋊ ℤ/2 with b a b⁻¹ = a⁵, written out here as a typed Cayley
    // table (the test's own oracle), so the axioms are checked by the reader.
    const lab = (i: number, j: number): string => `a${i}b${j}`;
    const labels: string[] = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < 8; i++) labels.push(lab(i, j));
    const rows = labels.map((_, x) => labels.map((__, y) => {
      const i1 = x % 8, j1 = Math.floor(x / 8), i2 = y % 8, j2 = Math.floor(y / 8);
      return lab((i1 + (j1 ? 5 : 1) * i2) % 8, (j1 + j2) % 2);
    }));
    const M2 = tableGroup(labels, rows);
    expect(statsKey(orderStats(A))).toBe(statsKey(orderStats(M2)));
    M2.name = "M₁₆";
    A.name = "ℤ/8ℤ × ℤ/2ℤ";
    const v = compareGroups(A, M2);
    expect(v.verdict).not.toBe("isomorphic");
  });
  it("Dic₃ is the fifth group of order 12 and Q₈ = Dic₂", () => {
    const D = dicyclicGroup(3);
    expect(D.n).toBe(12);
    expect(statsKey(orderStats(dicyclicGroup(2)))).toBe(statsKey(orderStats(quaternionGroup())));
  });
});

describe("display contract: printed names, elements and polynomials re-read", () => {
  it("foldSubscripts folds ₀–₉", () => {
    expect(foldSubscripts("ℤ₁₂ 𝔽₉ S₃")).toBe("ℤ_12 𝔽_9 S_3");
    expect(normalizeAlgebra("𝔽₉ ⟨4⟩ ℤ/6ℤ")).toBe("F_9 <4> Z/6Z");
  });
  it("every printed group name reads back as the same group", () => {
    const names = ["ℤ/12ℤ", "U(10)", "S₃", "D₄", "ℤ/2ℤ × ℤ/4ℤ", "V₄", "Q₈", "A₄", "Dic₃", "ℤ/4ℤ", "S₄", "D₈"];
    for (const nm of names) {
      const r = run(nm);
      expect(r.title).toContain(nm);
    }
  });
  it("printed results re-read: ⟨4⟩, (1 3), U(10) ≅ ℤ/4ℤ, 𝔽₉ = 𝔽₃[x]/(x² + 1), x³ + x² + 1", () => {
    expect(disp("⟨4⟩ in ℤ/12ℤ")).toMatch(/\{0, 4, 8\}/);
    expect(disp("(1 3)")).toMatch(/^\(1 3\)/);
    expect(disp("U(10) ≅ ℤ/4ℤ")).toMatch(/isomorphic/);
    expect(run("𝔽₉ = 𝔽₃[x]/(x² + 1)").display[0]).toMatch(/𝔽₉ = 𝔽₃\[x\]\/\(x² \+ 1\)/);
    expect(disp("is x³ + x² + 1 irreducible over 𝔽₂")).toMatch(/^yes/);
    expect(disp("factor x² + 1 over 𝔽₂")).toBe("x^2 + 1 = (x + 1)^2 over 𝔽₂");
  });
  it("every element label of the constructed groups re-reads to its own index", () => {
    const groups: FiniteGroup[] = [cyclicGroup(7), unitsGroup(15), symmetricGroup(4), alternatingGroup(4), dihedralGroup(6), quaternionGroup(), dicyclicGroup(3), productGroup([symmetricGroup(3), cyclicGroup(2)])];
    for (const G of groups) G.labels.forEach((l, i) => expect(G.read(normalizeAlgebra(l))).toBe(i));
  });
  it("ALGEBRA_RE matches raw unicode input too", () => {
    for (const q of ["ℤ₆", "𝔽₉", "S₃", "ℤ/6ℤ", "⟨4⟩ in ℤ/12ℤ"]) expect(ALGEBRA_RE.test(q)).toBe(true);
  });
});
