// Adversarial pins for the cobordism ring engine (cobordism.ts).
//
// The live defect was a verdict that FLIPPED on products and connected sums.
// So every base manifold in scope is combined with every other by # and ×,
// and each answer is checked against a rule that does not use the engine:
//   * Thom: 𝔑_* is a polynomial ring over 𝔽₂ — [M × N] = 0 ⇔ [M] = 0 or [N] = 0,
//     and [M # N] = [M] + [N];
//   * σ is multiplicative under × and additive under #, from intersection forms;
//   * orientability: M × N and M # N are orientable ⇔ both are.

import { parseManifold, analyseCobordism, cobordismQuery, CobordismElement, NUMBER_BUDGET } from "../cobordism";

const el = (s: string): CobordismElement => {
  const r = parseManifold(s);
  if ("error" in r) throw new Error(`${s}: ${r.error}`);
  return r;
};
const err = (s: string): string => {
  const r = parseManifold(s);
  return "error" in r ? r.error : "NO ERROR";
};

// Base manifolds, each with an INDEPENDENT unoriented verdict and orientability
// (textbook, not computed): ℝPⁿ bounds ⇔ n odd; ℂPⁿ bounds ⇔ n odd
// (χ = n+1 and the SW numbers of ℂP^{odd} vanish); spheres and tori bound;
// K3 bounds unoriented (spin, χ = 24 even, w = 1); Wu does not (w₂w₃ = 1).
const BASE: { s: string; bounds: boolean; orientable: boolean; dim: number; sigma: number }[] = [
  { s: "RP^1", bounds: true, orientable: true, dim: 1, sigma: 0 },
  { s: "RP^2", bounds: false, orientable: false, dim: 2, sigma: 0 },
  { s: "RP^3", bounds: true, orientable: true, dim: 3, sigma: 0 },
  { s: "RP^4", bounds: false, orientable: false, dim: 4, sigma: 0 },
  { s: "RP^5", bounds: true, orientable: true, dim: 5, sigma: 0 },
  { s: "CP^1", bounds: true, orientable: true, dim: 2, sigma: 0 },
  { s: "CP^2", bounds: false, orientable: true, dim: 4, sigma: 1 },
  { s: "CP^3", bounds: true, orientable: true, dim: 6, sigma: 0 },
  { s: "S^1", bounds: true, orientable: true, dim: 1, sigma: 0 },
  { s: "S^2", bounds: true, orientable: true, dim: 2, sigma: 0 },
  { s: "S^4", bounds: true, orientable: true, dim: 4, sigma: 0 },
  { s: "T^2", bounds: true, orientable: true, dim: 2, sigma: 0 },
  { s: "T^3", bounds: true, orientable: true, dim: 3, sigma: 0 },
  { s: "klein", bounds: true, orientable: false, dim: 2, sigma: 0 },
  { s: "K3", bounds: true, orientable: true, dim: 4, sigma: -16 },
  { s: "wu", bounds: false, orientable: true, dim: 5, sigma: 0 },
];

describe("every base manifold alone", () => {
  for (const b of BASE) {
    it(`${b.s}: bounds=${b.bounds}, orientable=${b.orientable}`, () => {
      const a = analyseCobordism(el(b.s));
      expect(a.contradiction).toBeUndefined();
      expect(a.unorientedBounds).toBe(b.bounds);
      expect(a.element.orientable).toBe(b.orientable);
      if (b.orientable && b.dim % 4 === 0) expect(Number(a.signature)).toBe(b.sigma);
    });
  }
});

describe("every pair under × — the integral-domain rule", () => {
  for (const x of BASE) for (const y of BASE) {
    if (x.dim + y.dim > 10) continue;
    it(`${x.s} × ${y.s}`, () => {
      const a = analyseCobordism(el(`${x.s} x ${y.s}`));
      expect(a.contradiction).toBeUndefined();
      expect(a.unorientedBounds).toBe(x.bounds || y.bounds);
      expect(a.element.orientable).toBe(x.orientable && y.orientable);
      if (x.orientable && y.orientable && (x.dim + y.dim) % 4 === 0) {
        // σ(M × N) = σ(M)σ(N), with σ = 0 off dimensions 4k.
        const sx = x.dim % 4 === 0 ? x.sigma : 0, sy = y.dim % 4 === 0 ? y.sigma : 0;
        expect(Number(a.signature)).toBe(sx * sy + 0); // + 0 turns −0 into 0
      }
    });
  }
});

describe("every equal-dimension pair under # — additivity", () => {
  for (const x of BASE) for (const y of BASE) {
    if (x.dim !== y.dim) continue;
    it(`${x.s} # ${y.s}`, () => {
      const a = analyseCobordism(el(`${x.s} # ${y.s}`));
      expect(a.contradiction).toBeUndefined();
      // [M # N] = [M] + [N]; with each base class 0 or a single nonzero class,
      // the sum is 0 iff both are 0 or both are the SAME nonzero class.
      const same = x.s === y.s || (["RP^2"].includes(x.s) && ["RP^2"].includes(y.s));
      const expected = x.bounds && y.bounds ? true : x.bounds !== y.bounds ? false : same ? true : null;
      if (expected !== null) expect(a.unorientedBounds).toBe(expected);
      expect(a.element.orientable).toBe(x.orientable && y.orientable);
      if (x.orientable && y.orientable && x.dim % 4 === 0) expect(Number(a.signature)).toBe(x.sigma + y.sigma);
    });
  }
});

describe("the separate verdicts that are easy to conflate", () => {
  it("K3 bounds unoriented but NOT oriented", () => {
    const a = analyseCobordism(el("K3"));
    expect([a.unorientedBounds, a.orientedBounds]).toEqual([true, false]);
  });
  it("ℂP² # ℂP² bounds unoriented (2·[ℂP²] ≡ 0 mod 2) but NOT oriented (σ = 2)", () => {
    const a = analyseCobordism(el("CP^2 # CP^2"));
    expect([a.unorientedBounds, a.orientedBounds]).toEqual([true, false]);
  });
  it("ℂP² # ℂP²bar bounds in both", () => {
    const a = analyseCobordism(el("CP^2 # CP^2bar"));
    expect([a.unorientedBounds, a.orientedBounds]).toEqual([true, true]);
  });
  it("Wu × Wu (dim 10): nonzero SW number ⇒ does NOT bound oriented, even beyond the table", () => {
    const a = analyseCobordism(el("wu x wu"));
    expect(a.orientedBounds).toBe(false);
  });
  it("S⁴ × S⁶ (dim 10): every number vanishes but n ≥ 9 — 'bounds (oriented)' is NOT claimed", () => {
    const a = analyseCobordism(el("S^4 x S^6"));
    expect(a.unorientedBounds).toBe(true);
    expect(a.orientedBounds).toBeNull();
    expect(cobordismQuery("oriented cobordism of S^4 x S^6")!.display.join(" ")).toMatch(/outside the cited table/);
  });
});

describe("orientability mismatches and orientation reversal", () => {
  it("−ℝP² is refused by name", () => {
    expect(err("-RP^2")).toMatch(/not orientable — orientation reversal \(−\) does not apply/);
    expect(err("CP^2 - RP^4")).toMatch(/not orientable/);
    expect(err("RP^2bar")).toMatch(/not orientable/);
  });
  it("ℝP⁴ # ℂP² is non-orientable: oriented question answered as unoriented only", () => {
    const r = cobordismQuery("oriented cobordism of RP^4 # CP^2")!;
    expect(r.title).toMatch(/^Unoriented cobordism/);
    expect(r.display.join(" ")).toMatch(/not orientable — only unoriented cobordism applies/);
  });
  it("double negation and bar of bar", () => {
    expect(analyseCobordism(el("--CP^2")).signature).toBe(1n);
    expect(analyseCobordism(el("-CP^2bar")).signature).toBe(1n);
  });
});

describe("ℝP^even vs ℝP^odd", () => {
  it("ℝP^odd × anything bounds; ℝP^even × ℝP^even does not", () => {
    for (const [m, n] of [[2, 2], [2, 4], [4, 4], [2, 6]]) {
      expect(analyseCobordism(el(`RP^${m} x RP^${n}`)).unorientedBounds).toBe(false);
    }
    for (const [m, n] of [[1, 2], [3, 4], [5, 2], [3, 3]]) {
      expect(analyseCobordism(el(`RP^${m} x RP^${n}`)).unorientedBounds).toBe(true);
    }
  });
  it("ℝP² + ℝP² (= 2·ℝP²) bounds; ℝP² + ℝP² + ℝP² does not", () => {
    expect(analyseCobordism(el("RP^2 + RP^2")).unorientedBounds).toBe(true);
    expect(analyseCobordism(el("RP^2 + RP^2 + RP^2")).unorientedBounds).toBe(false);
    expect(analyseCobordism(el("3 RP^2")).unorientedBounds).toBe(false);
  });
  it("ℝP⁴ vs ℂP² are NOT cobordant (w₁⁴[ℝP⁴] = 1, w₁ = 0 on ℂP²)", () => {
    expect(cobordismQuery("is rp^4 cobordant to cp^2")!.display[0]).toMatch(/NOT cobordant/);
  });
  // Hand check, independent of the engine: on ℝP² × ℝP², w = (1+a+a²)(1+b+b²),
  // so w₁ = a+b, w₂ = a²+ab+b², w₃ = a²b+ab², w₄ = a²b². Then w₄ = w₂² = 1 and
  // w₁⁴ = w₁²w₂ = w₁w₃ = 0 — exactly ℂP²'s numbers (w₂² = w₄ = 1, w₁ = 0). So
  // [ℂP²] = [ℝP² × ℝP²] in 𝔑₄, the classical relation, and their sum bounds.
  it("ℝP² × ℝP² is unorientedly cobordant to ℂP² (hand-checked SW numbers)", () => {
    const a = analyseCobordism(el("RP^2 x RP^2 + CP^2"));
    expect(a.contradiction).toBeUndefined();
    expect(a.unorientedBounds).toBe(true);
    expect(cobordismQuery("is rp^2 x rp^2 cobordant to cp^2")!.display[0]).toMatch(/Unoriented: COBORDANT/);
  });
});

describe("refused by name", () => {
  it("a manifold outside the generator list", () => {
    expect(err("lens space")).toMatch(/"lens" is not a manifold this tool knows/);
    expect(err("genus 2 surface")).toMatch(/not a manifold this tool knows/);
  });
  it("ℍPⁿ: the unconfirmed citation is refused, not shipped", () => {
    expect(err("HP^2")).toMatch(/could not be confirmed/);
  });
  it("dimension mismatches in # and +", () => {
    expect(err("RP^2 # CP^2")).toMatch(/Dimension 2 vs 4/);
    expect(err("S^1 + S^2")).toMatch(/Dimension 1 vs 2/);
    expect(err("pt # pt")).toMatch(/0-manifolds/);
  });
  it("dimension above 40", () => {
    expect(err("RP^41")).toMatch(/outside the computed range/);
    expect(err("CP^20 x CP^1")).toMatch(/dimension 42/);
  });
  it("unbalanced or dangling operators", () => {
    expect(err("(CP^2 # CP^2")).toMatch(/Unbalanced/);
    expect(err("CP^2 #")).toMatch(/ends where a manifold was expected/);
  });
});

describe("parsing variants all mean the same element", () => {
  const sig = (s: string) => String(analyseCobordism(el(s)).signature);
  it("× spellings", () => {
    for (const s of ["CP^2 x CP^2", "CP^2 × CP^2", "cp2 x cp2", "CP^2*CP^2", "ℂP² × ℂP²", "(CP^2)(CP^2)", "cp^{2} x cp^{2}"]) {
      expect(`${s}: ${sig(s)}`).toBe(`${s}: 1`);
    }
  });
  it("conjugate spellings", () => {
    for (const s of ["CP^2bar", "CP^2 bar", "cp^2-bar", "-CP^2", "−ℂP²", "cp^2 conj"]) {
      expect(`${s}: ${sig(s)}`).toBe(`${s}: -1`);
    }
  });
  it("× binds tighter than #", () => {
    // CP^2 x S^0... use equal dims: S^2 x S^2 # CP^2 = (S² × S²) # ℂP², σ = 0 + 1.
    expect(sig("S^2 x S^2 # CP^2")).toBe("1");
  });
  it("Klein bottle names", () => {
    for (const s of ["klein", "klein bottle", "the klein bottle", "RP^2 # RP^2", "ℝP² # ℝP²"]) {
      expect(`${s}: ${analyseCobordism(el(s)).unorientedBounds}`).toBe(`${s}: true`);
    }
  });
  it("S⁰ and S⁰ × S⁰ bound (∂ of an interval / of two intervals)", () => {
    expect(analyseCobordism(el("S^0")).unorientedBounds).toBe(true);
    expect(analyseCobordism(el("S^0 x S^0")).orientedBounds).toBe(true);
    expect(analyseCobordism(el("pt")).orientedBounds).toBe(false);
  });
});

describe("4 s bounds — the budget makes every input terminate", () => {
  it("ℝP²⁰ × ℝP²⁰ (dim 40, p(40) = 37 338 numbers) answers or refuses within 4 s", () => {
    const t0 = Date.now();
    const a = analyseCobordism(el("RP^20 x RP^20"));
    expect(Date.now() - t0).toBeLessThan(4000);
    // Either way the factor-wise rule decides it: neither factor bounds.
    expect(a.unorientedBounds).toBe(false);
  });
  it("ℝP⁴⁰ alone within 4 s, does not bound", () => {
    const t0 = Date.now();
    expect(analyseCobordism(el("RP^40")).unorientedBounds).toBe(false);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
  it("a long connected sum of products within 4 s", () => {
    const t0 = Date.now();
    const s = Array.from({ length: 10 }, () => "RP^2 x RP^2 x RP^2 x RP^2 x RP^2").join(" # ");
    const a = analyseCobordism(el(s));
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(a.unorientedBounds).toBe(true); // 10 copies ≡ 0 mod 2
  });
  it("ℂP¹⁰ × ℂP¹⁰ (dim 40) within 4 s, σ = 1 or refused by budget", () => {
    const t0 = Date.now();
    const a = analyseCobordism(el("CP^10 x CP^10"));
    expect(Date.now() - t0).toBeLessThan(4000);
    if (a.signature !== null) expect(a.signature).toBe(1n);
  });
  it("a product too big to enumerate falls back to the factor rule, and says so", () => {
    const t0 = Date.now();
    const a = analyseCobordism(el(Array.from({ length: 10 }, () => "RP^4").join(" x ")));
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(a.sw).toBeNull();
    expect(a.unorientedBounds).toBe(false);
    expect(a.steps.join(" ")).toMatch(/exceeds its budget/);
    expect(a.steps.join(" ")).toMatch(/integral domain|polynomial ring/);
  });
  it("a SUM too big to enumerate is not decided (no factor rule for sums)", () => {
    const big = Array.from({ length: 10 }, () => "RP^4").join(" x ");
    const a = analyseCobordism(el(`${big} + ${big.replace(/RP\^4/g, "CP^2")}`));
    expect(a.unorientedBounds).toBeNull();
  });
  it("the budget is a named constant", () => {
    expect(NUMBER_BUDGET).toBeGreaterThan(0);
  });
});
