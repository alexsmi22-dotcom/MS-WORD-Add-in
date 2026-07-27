// Adversarial bug test — simplicial homology (homology.ts).
//
// Written after v2.8.0 shipped WITHOUT an adversarial pass. Probing found a
// real defect: the size cap was checked in homology() only AFTER allFaces()
// had already enumerated everything, so four 18-vertex simplices built
// 1,048,572 faces and took 8.8 SECONDS before the guard fired. Solve
// recomputes on every keystroke, so that is a multi-second freeze per
// character typed. The bound is now projected up front, and this pins it.

import { homology, allFaces, smithNormalForm, solveTopology, BUILTIN } from "../homology";

describe("the size guard fires BEFORE enumeration, not after", () => {
  it("a complex that would explode is refused in milliseconds", () => {
    const big = [0, 1, 2, 3].map((k) => Array.from({ length: 18 }, (_, i) => k * 100 + i));
    const t0 = Date.now();
    expect(() => homology({ maximal: big })).toThrow(/past this tool/);
    // The old code took ~8800ms here. Anything near that is the bug returning.
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("the refusal states the projected size", () => {
    const big = [Array.from({ length: 19 }, (_, i) => i)];
    expect(() => allFaces(big)).toThrow(/would generate at least/);
  });
  it("an oversized single simplex is caught by the vertex bound", () => {
    expect(() => allFaces([Array.from({ length: 25 }, (_, i) => i)])).toThrow(/more than 20 vertices/);
  });
  it("a legitimately large-but-allowed complex still computes", () => {
    const faces: number[][] = [];
    for (let i = 0; i < 200; i++) faces.push([i, i + 1, i + 2]);
    const t0 = Date.now();
    const h = homology({ maximal: faces });
    expect(h.eulerAgrees).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("odd and degenerate complexes are handled, not crashed on", () => {
  const CASES: [string, number[][]][] = [
    ["empty complex", []],
    ["single vertex", [[0]]],
    ["isolated vertex plus a triangle", [[0, 1, 2], [99]]],
    ["repeated vertex inside a simplex", [[0, 0, 1]]],
    ["negative vertex ids", [[-1, -2], [-2, -3], [-1, -3]]],
    ["duplicated maximal simplices", [[0, 1, 2], [0, 1, 2], [0, 1, 2]]],
    ["huge sparse vertex ids", [[1000000, 2000000], [2000000, 3000000], [1000000, 3000000]]],
  ];
  for (const [name, maximal] of CASES) {
    it(`${name}: computes, and its Euler check agrees`, () => {
      const h = homology({ maximal });
      expect(h.eulerAgrees).toBe(true);
      expect(h.caveats.some((c) => /INTERNAL CHECK FAILED/.test(c))).toBe(false);
      for (const b of h.betti) expect(Number.isFinite(b)).toBe(true);
    });
  }
  it("an isolated vertex genuinely raises beta_0", () => {
    expect(homology({ maximal: [[0, 1, 2], [99]] }).betti[0]).toBe(2);
  });
  it("negative and sparse vertex ids still give a circle", () => {
    expect(homology({ maximal: [[-1, -2], [-2, -3], [-1, -3]] }).betti).toEqual([1, 1]);
    expect(homology({ maximal: [[1000000, 2000000], [2000000, 3000000], [1000000, 3000000]] }).betti).toEqual([1, 1]);
  });
});

describe("Smith Normal Form stress", () => {
  it("terminates, respects the rank bound, and keeps the divisibility chain", () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let trial = 0; trial < 120; trial++) {
      const rows = 1 + (rnd() % 7), cols = 1 + (rnd() % 7);
      const m: bigint[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => BigInt((rnd() % 21) - 10)));
      const t0 = Date.now();
      const r = smithNormalForm(m);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(r.rank).toBeLessThanOrEqual(Math.min(rows, cols));
      // d1 | d2 | d3 … is the defining property of the normal form.
      for (let i = 1; i < r.divisors.length; i++) {
        expect(r.divisors[i] % r.divisors[i - 1]).toBe(0n);
      }
      for (const d of r.divisors) expect(d > 0n).toBe(true);
    }
  });
  it("the product of the divisors matches |det| for square nonsingular input", () => {
    // An independent check on the reduction: SNF preserves the determinant up
    // to sign, so prod(divisors) must equal |det| whenever the rank is full.
    const det3 = (m: bigint[][]): bigint =>
      m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    const CASES: bigint[][][] = [
      [[2n,0n,0n],[0n,3n,0n],[0n,0n,5n]],
      [[1n,2n,3n],[4n,5n,6n],[7n,8n,10n]],
      [[2n,4n,6n],[1n,3n,5n],[7n,1n,2n]],
      [[9n,-3n,4n],[-2n,7n,1n],[5n,0n,-6n]],
    ];
    for (const m of CASES) {
      const d = det3(m);
      const r = smithNormalForm(m.map((row) => row.slice()));
      if (d === 0n) continue;
      expect(r.rank).toBe(3);
      const prod = r.divisors.reduce((a, b) => a * b, 1n);
      expect(prod).toBe(d < 0n ? -d : d);
    }
  });

  it("handles empty, zero and rectangular matrices", () => {
    expect(smithNormalForm([]).rank).toBe(0);
    expect(smithNormalForm([[0n, 0n], [0n, 0n]]).rank).toBe(0);
    expect(smithNormalForm([[0n]]).rank).toBe(0);
    expect(smithNormalForm([[6n, 4n, 2n]]).divisors.map(String)).toEqual(["2"]);
  });
});

describe("the topology parser refuses rather than guessing", () => {
  it("empty, blank and nonsense input return null", () => {
    for (const s of ["", "   ", "nonsense space", "[]", "hello"]) {
      expect(solveTopology(s)).toBeNull();
    }
  });
  it("names are case- and spacing-insensitive", () => {
    expect(solveTopology("TORUS")!.betti).toEqual([1, 2, 1]);
    expect(solveTopology("Klein   Bottle")!.torsion[1].map(String)).toEqual(["2"]);
    expect(solveTopology("projective plane")!.groups[1]).toBe("Z/2");
  });
  it("every built-in name resolves and passes its own Euler check", () => {
    for (const name of Object.keys(BUILTIN)) {
      const r = solveTopology(name);
      expect(`${name}: ${r ? "ok" : "NULL"}`).toBe(`${name}: ok`);
      expect(r!.eulerAgrees).toBe(true);
    }
  });
});
