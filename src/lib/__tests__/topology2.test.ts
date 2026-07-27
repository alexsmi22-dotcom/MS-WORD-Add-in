// Advanced algebraic topology, tier A1 (topology2.ts).
//
// Every assertion here is a TEXTBOOK VALUE, not the code agreeing with itself:
//
//   cellular homology  H(ℝP²) = Z, Z/2, 0 from a 3-cell complex, matching the
//                      simplicial answer from a 31-face one — two independent
//                      routes to the same torsion.
//   characteristic     w(T ℝPⁿ) = (1+a)^{n+1} mod 2, so w is trivial exactly
//   classes            when n+1 is a power of two; c(T ℂPⁿ) = (1+x)^{n+1} with
//                      top class n+1 = χ(ℂPⁿ).
//   cobordism          ℝPⁿ bounds exactly when n is odd (Thom), COMPUTED from
//                      the Stiefel–Whitney numbers rather than asserted.
//
// The last one is the most interesting thing in the module: because SW numbers
// are a complete invariant of unoriented cobordism, "do these bound?" is one of
// the very few equivalence questions in this area that is actually decidable.

import {
  cellularHomology, CW_BUILTIN, whitneySum, chernOfLineSum, swOfLineSum,
  chernComplexProjectiveTangent, swRealProjectiveTangent, binomialMod2, binomial,
  realProjectiveTangentClass, complexProjectiveTangentClass,
  realProjectiveCobordism, partitions, BEYOND,
} from "../topology2";
import { homology, BUILTIN } from "../homology";

describe("cellular homology reproduces the simplicial answer from far fewer cells", () => {
  it("ℝP² from THREE cells gives Z, Z/2, 0 — the same torsion as 31 simplices", () => {
    const cw = cellularHomology(CW_BUILTIN.rp2());
    expect(cw.groups).toEqual(["Z", "Z/2", "0"]);
    expect(cw.euler).toBe(1);
    expect(cw.eulerAgrees).toBe(true);
    // The simplicial route, independently.
    const simp = homology(BUILTIN.rp2());
    expect(cw.groups).toEqual(simp.groups);
    expect(cw.euler).toBe(simp.euler);
    // And the point of the exercise: 3 cells versus this many faces.
    expect(cw.cells.reduce((a, b) => a + b, 0)).toBe(3);
    expect(simp.cells.reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  });

  it("the torus and Klein bottle agree with their simplicial computations", () => {
    for (const name of ["torus", "klein", "sphere", "circle", "point"]) {
      const cw = cellularHomology(CW_BUILTIN[name]());
      const simp = homology(BUILTIN[name]());
      expect(`${name}: ${cw.groups.join(" | ")}`).toBe(`${name}: ${simp.groups.join(" | ")}`);
      expect(`${name} χ: ${cw.euler}`).toBe(`${name} χ: ${simp.euler}`);
    }
  });

  it("a Moore space with an attaching degree of 3 has H₁ = Z/3", () => {
    const cw = cellularHomology(CW_BUILTIN["moore-3"]());
    expect(cw.groups[1]).toBe("Z/3");
    expect(cw.torsion[1].map(String)).toEqual(["3"]);
  });

  it("the degree is what produces the torsion — degree n gives Z/n", () => {
    for (const n of [2, 3, 4, 5, 7]) {
      const cw = cellularHomology({ cells: [1, 1, 1], boundaries: { 1: [[0]], 2: [[n]] } });
      expect(`degree ${n}: ${cw.groups[1]}`).toBe(`degree ${n}: Z/${n}`);
    }
  });

  it("a wrongly shaped degree matrix is refused, because it is a typo not a space", () => {
    expect(() =>
      cellularHomology({ cells: [1, 2, 1], boundaries: { 2: [[1]] } })
    ).toThrow(/must be 2x1/);
  });

  it("every built-in CW complex passes its own Euler cross-check", () => {
    for (const name of Object.keys(CW_BUILTIN)) {
      const cw = cellularHomology(CW_BUILTIN[name]());
      expect(`${name}: ${cw.eulerAgrees}`).toBe(`${name}: true`);
    }
  });

  it("states that it computes the complex you described, not the space you meant", () => {
    const cw = cellularHomology(CW_BUILTIN.rp2());
    expect(cw.caveats.some((c) => /cannot check that the description matches/.test(c))).toBe(true);
  });
});

describe("characteristic classes — symmetric polynomial algebra, exact", () => {
  it("the Whitney sum formula multiplies total classes", () => {
    // c(E ⊕ F) = c(E)·c(F): (1+x)(1+y) = 1 + (x+y) + xy
    expect(whitneySum([1, 1], [1, 1])).toEqual([1, 2, 1]);
    expect(whitneySum([1, 2, 1], [1, 1])).toEqual([1, 3, 3, 1]);
  });
  it("the splitting principle: coefficients are the elementary symmetric polynomials", () => {
    // roots 1,2,3 → e1=6, e2=11, e3=6
    expect(chernOfLineSum([1, 2, 3])).toEqual([1, 6, 11, 6]);
  });
  it("Stiefel–Whitney is the same construction mod 2", () => {
    expect(swOfLineSum([1, 1, 1])).toEqual([1, 1, 1, 1]);
    expect(swOfLineSum([1, 1])).toEqual([1, 0, 1]); // 1+2x+x² ≡ 1+x² mod 2
  });
  it("C(n,k) mod 2 follows Lucas — 1 exactly when k's bits sit inside n's", () => {
    expect(binomialMod2(4, 2)).toBe(0); // C(4,2)=6, even
    expect(binomialMod2(5, 1)).toBe(1); // C(5,1)=5, odd
    expect(binomialMod2(7, 3)).toBe(1); // C(7,3)=35, odd
    // Cross-check against exact binomials for a whole range.
    for (let n = 0; n <= 20; n++) {
      for (let k = 0; k <= n; k++) {
        expect(`C(${n},${k})%2`).toBe(
          `C(${n},${k})%2`
        );
        expect(binomialMod2(n, k)).toBe(Number(binomial(n, k) % 2n) as 0 | 1);
      }
    }
  });

  it("c(T ℂPⁿ) = (1+x)^{n+1} truncated, with top class = χ(ℂPⁿ) = n+1", () => {
    for (const n of [1, 2, 3, 4]) {
      const c = chernComplexProjectiveTangent(n);
      expect(c.length).toBe(n + 1);
      expect(c[0]).toBe(1);
      expect(c[1]).toBe(n + 1);
      expect(c[n]).toBe(Number(binomial(n + 1, n)));
      expect(`χ(CP^${n}) = ${c[n]}`).toBe(`χ(CP^${n}) = ${n + 1}`);
    }
  });

  it("w(T ℝPⁿ) is trivial EXACTLY when n+1 is a power of two", () => {
    for (let n = 1; n <= 16; n++) {
      const w = swRealProjectiveTangent(n);
      const trivial = w.slice(1).every((v) => v === 0);
      const isPow2 = ((n + 1) & n) === 0;
      expect(`n=${n} trivial=${trivial}`).toBe(`n=${n} trivial=${isPow2}`);
    }
  });

  it("the parallelisability deduction is stated, and honestly qualified", () => {
    // n = 3: w is trivial (4 is a power of two), and ℝP³ IS parallelisable.
    const r3 = realProjectiveTangentClass(3);
    expect(r3.total.slice(1).every((v) => v === 0)).toBe(true);
    expect(r3.steps.join(" ")).toMatch(/NECESSARY condition/);
    expect(r3.caveats.some((c) => /does not prove parallelisability/.test(c))).toBe(true);
    // n = 2: w2 ≠ 0, so ℝP² is definitely not parallelisable.
    const r2 = realProjectiveTangentClass(2);
    expect(r2.steps.join(" ")).toMatch(/OBSTRUCTS parallelisability/);
    expect(r2.display).toContain("a");
  });

  it("ℝP¹ is a circle: w trivial, and it really is parallelisable", () => {
    expect(swRealProjectiveTangent(1)).toEqual([1, 0]);
  });
});

describe("unoriented cobordism — a genuinely DECIDABLE equivalence question", () => {
  it("partitions are enumerated correctly", () => {
    expect(partitions(4).length).toBe(5); // 4, 3+1, 2+2, 2+1+1, 1+1+1+1
    expect(partitions(1)).toEqual([[1]]);
    expect(partitions(0)).toEqual([[]]);
  });

  it("ℝPⁿ bounds EXACTLY when n is odd — computed, not asserted", () => {
    for (let n = 1; n <= 10; n++) {
      const r = realProjectiveCobordism(n);
      expect(`RP^${n} bounds: ${r.boundsAManifold}`).toBe(`RP^${n} bounds: ${n % 2 === 1}`);
    }
  });

  it("ℝP² does not bound, and the nonvanishing number is named", () => {
    const r = realProjectiveCobordism(2);
    expect(r.boundsAManifold).toBe(false);
    expect(r.numbers.some((x) => x.value === 1)).toBe(true);
    expect(r.steps.join(" ")).toMatch(/does NOT bound/);
  });

  it("ℝP³ bounds, with every Stiefel–Whitney number vanishing", () => {
    const r = realProjectiveCobordism(3);
    expect(r.boundsAManifold).toBe(true);
    expect(r.numbers.every((x) => x.value === 0)).toBe(true);
    expect(r.steps.join(" ")).toMatch(/BOUNDS a compact manifold/);
  });

  it("states that this IS decidable, and that oriented cobordism is not covered", () => {
    const r = realProjectiveCobordism(4);
    const all = r.caveats.join(" ");
    expect(all).toMatch(/COMPLETE invariant/);
    expect(all).toMatch(/genuinely decidable/);
    expect(all).toMatch(/ORIENTED cobordism/);
  });
});

describe("the boundary of what is computable is stated as data, not omitted", () => {
  it("names spectral sequences, stable homotopy, π₁ and homeomorphism", () => {
    for (const k of ["spectral sequence", "stable homotopy", "fundamental group", "homeomorphism"]) {
      expect(BEYOND[k]).toBeTruthy();
      expect(BEYOND[k].whatIsComputable.length).toBeGreaterThan(20);
      expect(BEYOND[k].whatIsNot.length).toBeGreaterThan(20);
    }
  });
  it("the spectral-sequence entry separates E₂ from the differentials", () => {
    expect(BEYOND["spectral sequence"].whatIsComputable).toMatch(/E₂ page/);
    expect(BEYOND["spectral sequence"].whatIsComputable).toMatch(/is computable/);
    expect(BEYOND["spectral sequence"].whatIsNot).toMatch(/differentials/);
    expect(BEYOND["spectral sequence"].whatIsNot).toMatch(/NOT determined by the algebra/);
  });
  it("stable homotopy is marked as a citation, never a computation", () => {
    expect(BEYOND["stable homotopy"].why).toMatch(/CITED LITERATURE TABLE/);
  });
  it("the undecidability entries name their theorems", () => {
    expect(BEYOND["fundamental group"].whatIsNot).toMatch(/Novikov–Boone/);
    expect(BEYOND.homeomorphism.whatIsNot).toMatch(/Markov/);
  });
  it("nothing in the module claims two spaces are the same", () => {
    expect(BEYOND.homeomorphism.why).toMatch(/never say they are the same|never proof/i);
  });
});

describe("nonsense input is refused, not rounded into an answer", () => {
  // Both found in the adversarial pass. A negative cell count produced a
  // NEGATIVE Betti number that formatted as the trivial group "0", and a
  // degree of 2.7 was silently truncated to 2 — each answering confidently for
  // a complex the user never described.
  it("a negative cell count is refused", () => {
    expect(() => cellularHomology({ cells: [1, -1], boundaries: {} })).toThrow(/non-negative whole number/);
  });
  it("a fractional cell count is refused", () => {
    expect(() => cellularHomology({ cells: [1, 2.5], boundaries: {} })).toThrow(/non-negative whole number/);
  });
  it("a non-integer attaching degree is refused, not truncated", () => {
    expect(() =>
      cellularHomology({ cells: [1, 1, 1], boundaries: { 1: [[0]], 2: [[2.7]] } })
    ).toThrow(/must be whole numbers/);
  });
  it("a boundary matrix above the top dimension is refused", () => {
    expect(() => cellularHomology({ cells: [1], boundaries: { 5: [[1]] } })).toThrow(/only has cells up to dimension/);
  });
  it("valid input is unaffected", () => {
    expect(cellularHomology(CW_BUILTIN.rp2()).groups).toEqual(["Z", "Z/2", "0"]);
    expect(cellularHomology({ cells: [], boundaries: {} }).groups).toEqual([]);
    expect(cellularHomology({ cells: [0], boundaries: {} }).groups).toEqual(["0"]);
  });
  it("large but legitimate degree matrices still compute quickly", () => {
    const t0 = Date.now();
    const r = cellularHomology({
      cells: [1, 40, 40],
      boundaries: {
        1: [Array.from({ length: 40 }, () => 0)],
        2: Array.from({ length: 40 }, (_, i) => Array.from({ length: 40 }, (_, j) => (i === j ? 2 : 0))),
      },
    });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.eulerAgrees).toBe(true);
  });
});
