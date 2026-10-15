/**
 * Abstract algebra — the hostile pass (house rule: a separate adversarial
 * file). Degenerate groups, non-groups that look like groups, both sides of
 * every cap, reducible "moduli", Rabin at degree 30, the number-theory and
 * equation boundaries, and timing (every input < 1 s; 4 s gross freeze bound).
 */
import { tryAlgebra } from "../algebra";
import { DiscreteError, DiscreteResult } from "../discrete";
import { ppowmod, pmod, peq, rabinIrreducible, trialIrreducible, factorFp, P } from "../algebraFields";
import { parsePermProduct, composeFactors, cycleString } from "../algebraPerm";

// Design target: 1 s. The gate allows 4 s because parallel QC under agent load
// measured 1.1–1.4 s on inputs that take well under 1 s on an idle machine.
const LIMIT = 4000;
const timed = <T>(f: () => T, limit = LIMIT): T => {
  const t0 = Date.now();
  const r = f();
  const dt = Date.now() - t0;
  if (dt > 10000) throw new Error(`gross freeze: ${dt} ms`);
  if (dt > limit) throw new Error(`took ${dt} ms`);
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
  let r: DiscreteResult | null = null;
  try {
    r = timed(() => tryAlgebra(q));
  } catch (err) {
    if (err instanceof DiscreteError) return err.message;
    throw err;
  }
  throw new Error("answered, not refused: " + (r ? r.display.join(" / ") : "null"));
};

describe("degenerate groups", () => {
  it("Z/1 is the trivial group", () => {
    expect(run("Z/1").title).toBe("Group ℤ/1ℤ (order 1, cyclic, abelian)");
    expect(disp("Z/1")).toMatch(/ℤ\/1ℤ = \{0\}/);
  });
  it("S_1 = {e}", () => {
    expect(disp("S_1")).toMatch(/S₁ = \{e\}/);
  });
  it("U(1) is {0} (0 = 1 in ℤ/1ℤ) and U(2) = {1}", () => {
    expect(disp("U(1)")).toMatch(/U\(1\) = \{0\}/);
    expect(run("U(1)").caveats.join(" ")).toMatch(/0 and 1 coincide/);
    expect(disp("U(2)")).toMatch(/U\(2\) = \{1\}/);
  });
  it("D_1 has order 2 and D_2 order 4 (≅ the Klein four-group) — the n-gon convention said", () => {
    expect(run("D_1").title).toMatch(/order 2/);
    expect(run("D_2").title).toMatch(/order 4/);
    expect(disp("D_2")).toMatch(/≅ ℤ\/2ℤ × ℤ\/2ℤ/);
    expect(run("D_2").caveats.join(" ")).toMatch(/n-gon convention/);
    expect(run("D_8 of order 8").caveats.join(" ")).toMatch(/ORDER convention/);
    expect(run("dihedral group of order 8").title).toMatch(/D₄ \(order 8/);
  });
  it("Z/0 and negative moduli are refused by name", () => {
    expect(refusal("Z/0")).toMatch(/ℤ\/0ℤ is ℤ itself/);
    expect(refusal("Z/-6")).toMatch(/positive/);
    expect(refusal("7 * 9 mod 0")).toMatch(/mod 0/);
    expect(refusal("7 * 9 mod -12")).toMatch(/must be positive/);
  });
});

describe("tables that are not groups", () => {
  it("a non-associative Latin square (an order-5 loop) is refused naming the failing triple", () => {
    const loop = "cayley table:\n0 1 2 3 4\n1 0 3 4 2\n2 4 0 1 3\n3 2 4 0 1\n4 3 1 2 0";
    const msg = refusal(loop);
    expect(msg).toMatch(/Associativity fails: \(\w+ · \w+\) · \w+ = \w+ but \w+ · \(\w+ · \w+\) = \w+ at a = \w+, b = \w+, c = \w+/);
    // and the bare grid (no heading) is the same verdict — it is a Latin square, so it is claimed
    expect(refusal("0 1 2 3 4\n1 0 3 4 2\n2 4 0 1 3\n3 2 4 0 1\n4 3 1 2 0")).toMatch(/Associativity fails/);
  });
  it("two left identities and no two-sided one: refused naming them", () => {
    expect(refusal("cayley table:\n* e a\ne e a\na e a")).toMatch(/No identity.*e, a are left identities/);
  });
  it("an entry outside the set: closure fails, named", () => {
    expect(refusal("cayley table:\n* e a\ne e a\na a b")).toMatch(/Closure fails: a · a = "b"/);
  });
  it("a non-square table is refused", () => {
    expect(refusal("cayley table:\ne a b\na b")).toMatch(/not square/);
  });
  it("a bare grid that is not a Latin square is not claimed", () => {
    expect(tryAlgebra("A B\nB B")).toBeNull();
    expect(tryAlgebra("q0 0 q1\nq0 1 q0\nq1 0 q1")).toBeNull();
  });
});

describe("permutations", () => {
  it("(1 2 1) — a repeated point — is refused, never deduplicated", () => {
    expect(refusal("(1 2 1)")).toMatch(/repeats the point 1/);
  });
  it("degree 30 is read; 31 is refused before any work", () => {
    const c30 = "(" + Array.from({ length: 30 }, (_, i) => i + 1).join(" ") + ")";
    expect(disp(c30)).toMatch(/order 30/);
    expect(refusal("(1 31)")).toMatch(/up to degree 30/);
    expect(refusal("(1 2)(3 99999)")).toMatch(/up to degree 30/);
  });
  it("two cycles sharing a point are COMPOSED, not merged", () => {
    expect(disp("(1 2)(2 3)")).toMatch(/= \(1 2 3\)/);
  });
  it("composition is checked point by point against the printed result", () => {
    const pp = parsePermProduct("(1 3 5)(2 4)(1 2)")!;
    const p = composeFactors(pp.factors.map((f) => f.perm), pp.degree);
    expect(cycleString(p)).toBe(disp("(1 3 5)(2 4)(1 2)").split("\n")[0].split(" = ")[1]);
  });
  it("e, id and () are the identity", () => {
    expect(disp("(1 2)(1 2)")).toMatch(/= e/);
    expect(disp("inverse of e")).toMatch(/= e/);
  });
  it("a bare pair larger-first is the binomial (n k), not a transposition; points and vectors are not cycles", () => {
    expect(tryAlgebra("(10 3)")).toBeNull();
    for (const q of ["(1, 2)", "(0, 0, 1)", "(1, 2) (2, 3) (4, 7)", "(12)", "[1, 2]", "[0, 1]", "(4, 0), z = 20"]) expect(tryAlgebra(q)).toBeNull();
    expect(disp("(1,2,3)(4,5)")).toMatch(/order 6/);
  });
  it("one-line forms that are not permutations", () => {
    expect(refusal("permutation 2 2 1")).toMatch(/not a permutation of 1…3/);
    expect(tryAlgebra("[2 2 1]")).toBeNull();
  });
});

describe("caps — both sides of every boundary", () => {
  it("|G| = 120 is in (S5, A5 x Z/2, Z/120); 121 is out by name", () => {
    expect(run("S5").title).toMatch(/order 120/);
    expect(run("Z/120").title).toMatch(/order 120/);
    expect(refusal("Z/121")).toMatch(/order 121 — above the cap \|G\| ≤ 120/);
    expect(refusal("S6")).toMatch(/720/);
    expect(refusal("Z/11 x Z/11")).toMatch(/121/);
  });
  it("all subgroups only to |G| ≤ 24: S4 in, Z/25 out — before any work", () => {
    expect(disp("subgroups of S4")).toMatch(/30 subgroups/);
    expect(refusal("subgroups of Z/25")).toMatch(/above the cap \|G\| ≤ 24/);
    expect(refusal("subgroups of S5")).toMatch(/156 of them/);
  });
  it("GF(1024) is in; GF(2048) is out by name", () => {
    expect(run("GF(1024)").title).toBe("Finite field GF(1024)");
    expect(refusal("GF(2048)")).toMatch(/2048 > 1024|above the cap q ≤ 1024/);
    expect(refusal("GF(2^20)")).toMatch(/above the cap/);
  });
  it("listing irreducibles: 2¹¹ candidates in (186, Gauss), 2¹² out by name", () => {
    expect(disp("irreducible polynomials of degree 11 over F_2")).toMatch(/\(186\)$/);
    expect(refusal("irreducible polynomials of degree 12 over F_2")).toMatch(/2\^12 candidates — above the cap of 2,048/);
  });
  it("GF(q) with q not a prime power, GF(1), GF(0)", () => {
    expect(refusal("GF(6)")).toMatch(/not a prime power/);
    expect(refusal("GF(1)")).toMatch(/at least 2/);
    expect(refusal("GF(100)")).toMatch(/not a prime power/);
  });
  it("a reducible modulus is refused naming the factor", () => {
    expect(refusal("F_9 = F_3[x]/(x^2 + 2)")).toMatch(/x\^2 \+ 2 is reducible over 𝔽₃: x\^2 \+ 2 = \(x \+ 1\)\(x \+ 2\)/);
    expect(refusal("GF(8) with a^3 = a^2 + a + 1")).toMatch(/reducible over 𝔽₂/);
  });
  it("factoring above the trial-division cap is refused by name, irreducibility still decided", () => {
    // degree 20 over F_7: 7^10 trial divisors; with no roots and reducible, factoring is refused.
    const msg = refusal("factor (x^10 + 3)(x^10 + 5) over F_7");
    expect(msg).toMatch(/above the cap|REDUCIBLE/);
  });
});

describe("𝔽p[x] hostile cases", () => {
  it("x^p − x over 𝔽p splits into all p linear factors", () => {
    for (const p of [2, 3, 5, 7, 11, 13, 101]) {
      const d = disp(`factor x^${p} - x over F_${p}`);
      const lin = (d.match(/\(x \+ \d+\)/g) ?? []).length + (/= x\(/.test(d) ? 1 : 0);
      expect(lin).toBe(p);
    }
  });
  it("a degree-30 polynomial over 𝔽₂ is decided by Rabin (trial division would need 2¹⁵ candidates)", () => {
    const r = run("is x^30 + x^6 + x^4 + x + 1 irreducible over F_2");
    expect(r.steps.join(" ")).toMatch(/Rabin/);
    expect(r.steps.join(" ")).not.toMatch(/trial division/);
    // Independent check: x has order exactly 2^30 − 1 modulo f (f primitive ⇒ irreducible).
    const f: P = new Array(31).fill(0);
    for (const e of [30, 6, 4, 1, 0]) f[e] = 1;
    const N = 2n ** 30n - 1n;
    const one = ppowmod([0, 1], N, f, 2);
    expect(peq(one, [1])).toBe(true);
    let notEarly = true;
    for (const r0 of [3n, 7n, 11n, 31n, 151n, 331n]) if (peq(ppowmod([0, 1], N / r0, f, 2), [1])) notEarly = false;
    expect(r.display[0].startsWith("yes")).toBe(notEarly);
    // And a reducible degree-30: (x^15 + x + 1)^2 = x^30 + x^2 + 1 over 𝔽₂.
    expect(disp("is x^30 + x^2 + 1 irreducible over F_2")).toMatch(/^no/);
  });
  it("the two irreducibility methods agree wherever both run (degree ≤ 8 over 𝔽₂, all 2⁸ monics)", () => {
    for (let idx = 0; idx < 256; idx++) {
      const f: P = [];
      let x = idx;
      for (let i = 0; i < 8; i++) { f.push(x % 2); x >>= 1; }
      f.push(1);
      expect(rabinIrreducible(f, 2)).toBe(trialIrreducible(f, 2).irreducible);
    }
  });
  it("factorisations multiply back (cross-checked by the engine; spot-checked here)", () => {
    const fz = factorFp([1, 0, 0, 1, 1, 0, 1], 2);
    let prod: P = [fz.lead];
    for (const { f, e } of fz.factors) for (let k = 0; k < e; k++) {
      const out = new Array(prod.length + f.length - 1).fill(0);
      prod.forEach((a, i) => f.forEach((b, j) => { out[i + j] = (out[i + j] + a * b) % 2; }));
      prod = out;
    }
    expect(peq(pmod(prod, [1], 2), [])).toBe(true);
    expect(peq(prod, [1, 0, 0, 1, 1, 0, 1])).toBe(true);
  });
  it("composite modulus: products are fine (a ring, said); irreducible / factor / gcd refused by name", () => {
    expect(all("(x + 3)(x + 3) mod 6")).toMatch(/x\^2 \+ 3/);
    expect(all("(x + 3)(x + 3) mod 6")).toMatch(/ring, not a field/);
    expect(refusal("is x^2 + 1 irreducible over Z/6")).toMatch(/not a field/);
    expect(refusal("gcd of x^2 + 1 and x + 1 over Z/6")).toMatch(/not a field/);
  });
  it("coefficients over a non-prime field are refused by name", () => {
    expect(refusal("factor x^2 + 1 over F_4")).toMatch(/not a prime field/);
  });
  it("deep nesting is a clean null, never a RangeError (the parser actually runs: under the 4,000-character input cap)", () => {
    const deep = "(".repeat(1800) + "x + 1" + ")".repeat(1800) + " mod 3";
    expect(deep.length).toBeLessThan(4000);
    let r: unknown = "unset";
    expect(() => { r = timed(() => tryAlgebra(deep)); }).not.toThrow();
    expect(r).toBeNull();
    const deepNum = "(".repeat(1800) + "7 * 9" + ")".repeat(1800) + " mod 12";
    expect(() => timed(() => tryAlgebra(deepNum))).not.toThrow();
  });
  it("a product of 1,000 cycles is read without recursion trouble", () => {
    const many = "(1 2)".repeat(700);
    expect(many.length).toBeLessThan(4000);
    expect(disp(many)).toMatch(/= e/);
  });
});

describe("boundaries with number theory and the Equation kind", () => {
  it("7 * 9 mod 12 is algebra; 7^100 mod 13 is number theory's (null here)", () => {
    expect(disp("7 * 9 mod 12")).toBe("7 · 9 ≡ 3 (mod 12)");
    expect(tryAlgebra("7^100 mod 13")).toBeNull();
  });
  it("Z/6 is a group; Z = 6 is an equation (null)", () => {
    expect(run("Z/6").title).toMatch(/ℤ\/6ℤ/);
    expect(tryAlgebra("Z = 6")).toBeNull();
  });
  it("x^2 = e alone is an equation (Euler's e), not a presentation", () => {
    expect(tryAlgebra("x^2 = e")).toBeNull();
    expect(refusal("<a, b | a^2 = b^3 = e>")).toMatch(/presentations/);
  });
  it("klein alone is topology's word, not V₄", () => {
    expect(tryAlgebra("klein")).toBeNull();
    expect(run("klein four group").title).toMatch(/V₄/);
  });
  it("S0, A00 and five-digit indices are labels, not groups", () => {
    for (const q of ["S0", "A00", "D654321"]) expect(tryAlgebra(q)).toBeNull();
  });
  it("is S4 isomorphic to S4 — the identity map, not 'undecided'", () => {
    expect(disp("is S4 isomorphic to S4")).toMatch(/identity map/);
  });
  it("D4 vs Q8: NOT isomorphic by order statistics", () => {
    expect(disp("is D4 isomorphic to Q8")).toMatch(/NOT isomorphic/);
  });
  it("an element that is not in the group is refused by name", () => {
    expect(refusal("order of 4 in U(10)")).toMatch(/4 is not in U\(10\)/);
    expect(refusal("order of (1 2)(3 4 5) in S4")).toMatch(/not a point of S₄/);
    expect(refusal("order of (1 2) in A3")).toMatch(/odd permutation/);
    expect(refusal("is {e, (1 2), (1 3)} normal in S3")).toMatch(/not a subgroup/);
  });
});

describe("timing: heavy inputs inside 1 s", () => {
  const HEAVY = [
    "S5", "A5", "conjugacy classes of S5", "cayley table of S5", "orders of all elements of S5", "center of S5", "isomorphism type of S5",
    "subgroups of S4", "subgroup lattice of S4", "all subgroups of D12", "is S4 isomorphic to Z/2 x A4", "GF(1024)", "elements of GF(729)",
    "primitive element of GF(1024)", "minimal polynomial of a^5 in GF(1024)", "factor x^101 - x over F_101", "is x^30 + x + 1 irreducible over F_2",
    "irreducible polynomials of degree 11 over F_2", "irreducible polynomials of degree 6 over F_3", "D_60", "Z/2 x Z/2 x Z/2 x Z/3 x Z/5", "x^2 + 1 = 0 mod 999983",
    "2^1000000 * 3 mod 7", "(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30)^1000000007",
  ];
  it.each(HEAVY)("%s", (q) => {
    const t0 = Date.now();
    try {
      tryAlgebra(q);
    } catch (err) {
      if (!(err instanceof DiscreteError)) throw err;
    }
    expect(Date.now() - t0).toBeLessThan(LIMIT);
  });
});
