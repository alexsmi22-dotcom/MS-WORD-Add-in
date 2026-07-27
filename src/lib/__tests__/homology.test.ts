// Simplicial homology over ℤ (homology.ts) — Release T1.
//
// The built-in spaces ARE the oracle: their homology is textbook and
// non-negotiable, so any error in the Smith Normal Form, the boundary maps or
// the triangulations shows up here immediately.
//
//   H(S¹)   = Z, Z                 H(S²)  = Z, 0, Z
//   H(T²)   = Z, Z², Z             β(T²)  = 1, 2, 1
//   H(ℝP²)  = Z, Z/2, 0            ← TORSION: the reason for ℤ, not ℚ
//   H(Klein)= Z, Z ⊕ Z/2, 0        ← torsion again, with a free part
//
// Plus the internal Euler-characteristic cross-check, which must hold for every
// input, and the algebraic property that ∂∘∂ = 0 — if that fails the boundary
// matrices are wrong regardless of what the Betti numbers happen to say.

import {
  homology, allFaces, boundaryMatrix, smithNormalForm, BUILTIN, Complex,
} from "../homology";

const H = (name: string) => homology(BUILTIN[name]());

describe("Smith Normal Form over Z", () => {
  it("diagonalises a simple integer matrix with the right divisors", () => {
    // [[2,4],[6,8]] has determinant -8; divisors 2 and 4.
    const r = smithNormalForm([[2n, 4n], [6n, 8n]]);
    expect(r.rank).toBe(2);
    expect(r.divisors.map(String)).toEqual(["2", "4"]);
  });
  it("finds the rank of a rank-deficient matrix", () => {
    const r = smithNormalForm([[1n, 2n], [2n, 4n]]);
    expect(r.rank).toBe(1);
  });
  it("handles the zero matrix", () => {
    expect(smithNormalForm([[0n, 0n], [0n, 0n]]).rank).toBe(0);
  });
  it("handles a rectangular matrix", () => {
    const r = smithNormalForm([[1n, 0n, 0n], [0n, 3n, 0n]]);
    expect(r.rank).toBe(2);
    expect(r.divisors.map(String)).toEqual(["1", "3"]);
  });
  it("produces divisors in a divisibility chain", () => {
    const r = smithNormalForm([[2n, 0n], [0n, 3n]]);
    // d1 | d2 always; for diag(2,3) the SNF is diag(1,6).
    expect(r.divisors.map(String)).toEqual(["1", "6"]);
  });
});

describe("boundary maps", () => {
  it("∂∘∂ = 0 for every built-in complex", () => {
    for (const name of ["circle", "sphere", "torus", "klein", "rp2", "mobius", "disk", "annulus"]) {
      const faces = allFaces(BUILTIN[name]().maximal);
      for (let k = 2; k < faces.length; k++) {
        const d1 = boundaryMatrix(faces[k], faces[k - 1]);      // rows k-1, cols k
        const d0 = boundaryMatrix(faces[k - 1], faces[k - 2]);  // rows k-2, cols k-1
        // product d0 · d1 must be the zero matrix
        for (let r = 0; r < d0.length; r++) {
          for (let c = 0; c < (d1[0]?.length ?? 0); c++) {
            let s = 0n;
            for (let i = 0; i < d1.length; i++) s += d0[r][i] * d1[i][c];
            expect(`${name} d∘d[${r}][${c}]=${s}`).toBe(`${name} d∘d[${r}][${c}]=0`);
          }
        }
      }
    }
  });
});

describe("the textbook spaces — the oracle", () => {
  it("point: H = Z", () => {
    const h = H("point");
    expect(h.betti).toEqual([1]);
    expect(h.groups).toEqual(["Z"]);
    expect(h.euler).toBe(1);
  });
  it("two points: β₀ = 2, and it reports being disconnected", () => {
    const h = H("two-points");
    expect(h.betti[0]).toBe(2);
    expect(h.connected).toBe(false);
  });
  it("interval and disk are contractible: H = Z, 0", () => {
    for (const n of ["interval", "disk", "tetrahedron"]) {
      const h = H(n);
      expect(h.betti[0]).toBe(1);
      expect(h.betti.slice(1).every((b) => b === 0)).toBe(true);
      expect(h.euler).toBe(1);
    }
  });
  it("S¹: H = Z, Z and χ = 0", () => {
    const h = H("circle");
    expect(h.betti).toEqual([1, 1]);
    expect(h.groups).toEqual(["Z", "Z"]);
    expect(h.euler).toBe(0);
  });
  it("S²: H = Z, 0, Z and χ = 2", () => {
    const h = H("sphere");
    expect(h.betti).toEqual([1, 0, 1]);
    expect(h.groups).toEqual(["Z", "0", "Z"]);
    expect(h.euler).toBe(2);
  });
  it("S³: H = Z, 0, 0, Z and χ = 0", () => {
    const h = H("s3");
    expect(h.betti).toEqual([1, 0, 0, 1]);
    expect(h.euler).toBe(0);
  });
  it("TORUS: β = 1, 2, 1 and χ = 0", () => {
    const h = H("torus");
    expect(h.betti).toEqual([1, 2, 1]);
    expect(h.groups).toEqual(["Z", "Z^2", "Z"]);
    expect(h.euler).toBe(0);
    expect(h.torsion.every((t) => t.length === 0)).toBe(true); // orientable: no torsion
  });
  it("figure eight: β₁ = 2", () => {
    const h = H("wedge-two-circles");
    expect(h.betti[0]).toBe(1);
    expect(h.betti[1]).toBe(2);
  });
  it("Möbius band deformation-retracts to a circle: H = Z, Z", () => {
    const h = H("mobius");
    expect(h.betti[0]).toBe(1);
    expect(h.betti[1]).toBe(1);
    expect(h.euler).toBe(0);
  });
  it("annulus also retracts to a circle", () => {
    const h = H("annulus");
    expect(h.betti[0]).toBe(1);
    expect(h.betti[1]).toBe(1);
  });
});

describe("TORSION — the whole reason for computing over Z", () => {
  it("ℝP²: H = Z, Z/2, 0 — β₁ is 0 but H₁ is NOT trivial", () => {
    const h = H("rp2");
    expect(h.euler).toBe(1);
    expect(h.betti).toEqual([1, 0, 0]);
    expect(h.torsion[1].map(String)).toEqual(["2"]);
    expect(h.groups[1]).toBe("Z/2");
    // The point of the test: over a field this would read "β₁ = 0" and the
    // Z/2 would be gone without trace.
    expect(h.caveats.some((c) => /TORSION/i.test(c))).toBe(true);
  });
  it("Klein bottle: H = Z, Z ⊕ Z/2, 0", () => {
    const h = H("klein");
    expect(h.euler).toBe(0);
    expect(h.betti[0]).toBe(1);
    expect(h.betti[1]).toBe(1);
    expect(h.betti[2]).toBe(0); // non-orientable: no fundamental class over Z
    expect(h.torsion[1].map(String)).toEqual(["2"]);
    expect(h.groups[1]).toBe("Z + Z/2");
  });
  it("the orientable surfaces have NO torsion, which is the contrast", () => {
    for (const n of ["sphere", "torus"]) {
      expect(H(n).torsion.every((t) => t.length === 0)).toBe(true);
    }
  });
});

describe("the internal Euler-characteristic cross-check", () => {
  it("agrees for every built-in complex", () => {
    for (const name of Object.keys(BUILTIN)) {
      const h = H(name);
      expect(`${name}: ${h.euler} vs ${h.eulerFromBetti}`).toBe(`${name}: ${h.euler} vs ${h.euler}`);
      expect(h.eulerAgrees).toBe(true);
      expect(h.caveats.some((c) => /INTERNAL CHECK FAILED/.test(c))).toBe(false);
    }
  });
  it("agrees for ad-hoc complexes too", () => {
    const ADHOC: number[][][] = [
      [[0, 1, 2], [2, 3, 4]],
      [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
      [[0, 1, 2, 3]],
      [[0], [1], [2], [3], [4]],
      [[0, 1, 2], [0, 1, 3], [0, 2, 3]],
    ];
    for (const maximal of ADHOC) {
      const h = homology({ maximal });
      expect(h.eulerAgrees).toBe(true);
    }
  });
  it("known surface Euler characteristics come out right", () => {
    expect(H("sphere").euler).toBe(2);
    expect(H("torus").euler).toBe(0);
    expect(H("klein").euler).toBe(0);
    expect(H("rp2").euler).toBe(1);
  });
});

describe("robustness", () => {
  it("faces are deduplicated, so repeating a simplex changes nothing", () => {
    const a = homology({ maximal: [[0, 1, 2]] });
    const b = homology({ maximal: [[0, 1, 2], [0, 1, 2], [0, 1], [2]] });
    expect(b.betti).toEqual(a.betti);
    expect(b.cells).toEqual(a.cells);
  });
  it("vertex ids need not be contiguous or sorted", () => {
    const h = homology({ maximal: [[7, 3], [3, 99], [99, 7]] });
    expect(h.betti).toEqual([1, 1]); // still a circle
  });
  it("a huge complex is refused with a reason rather than hanging", () => {
    expect(() => homology({ maximal: [Array.from({ length: 25 }, (_, i) => i)] })).toThrow(/more than 20 vertices/);
  });
});
