// Adversarial / invariant-based stress tests for the Analyze linear-algebra and
// data modules. Random matrices (deterministic PRNG) are checked against
// mathematical identities that MUST hold, plus degenerate edge cases that tend
// to break numerical code. This is the "nothing ships without a bug test" pass.

import {
  Matrix,
  multiply,
  transpose,
  identity,
  determinant,
  inverse,
  solve,
  rank,
  trace,
  eigenSymmetric,
  eigenvaluesGeneral,
  qrDecompose,
  svd,
  Complex,
} from "../linalg";
import { analyzeData, correlate, summarizeColumn, parseTable } from "../insights";
import { parseDefinitions, evalMatrixExpression } from "../matrixExpr";

// Deterministic PRNG (mulberry32) — reproducible, no Math.random flakiness.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randMatrix(rng: () => number, n: number, m = n, lo = -5, hi = 5): Matrix {
  return Array.from({ length: n }, () => Array.from({ length: m }, () => lo + (hi - lo) * rng()));
}

function maxAbsDiff(a: Matrix, b: Matrix): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) d = Math.max(d, Math.abs(a[i][j] - b[i][j]));
  return d;
}

function cMul(x: Complex, y: Complex): Complex {
  return { re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re };
}

describe("linear-algebra invariants over random matrices", () => {
  const rng = mulberry32(12345);
  const SIZES = [1, 2, 3, 4, 5];
  const PER_SIZE = 40;

  it("QR: Q·R = A and Qᵀ·Q = I", () => {
    for (const n of SIZES) {
      for (let it = 0; it < PER_SIZE; it++) {
        const A = randMatrix(rng, n);
        const { Q, R } = qrDecompose(A);
        expect(maxAbsDiff(multiply(Q, R)!, A)).toBeLessThan(1e-8);
        expect(maxAbsDiff(multiply(transpose(Q), Q)!, identity(n))).toBeLessThan(1e-8);
        // R upper-triangular
        for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) expect(Math.abs(R[i][j])).toBeLessThan(1e-8);
      }
    }
  });

  it("SVD: U·diag(S)·Vᵀ = A, S descending ≥ 0", () => {
    for (const n of SIZES) {
      for (let it = 0; it < PER_SIZE; it++) {
        const A = randMatrix(rng, n);
        const { U, S, V } = svd(A);
        for (let i = 1; i < S.length; i++) expect(S[i]).toBeLessThanOrEqual(S[i - 1] + 1e-9);
        expect(Math.min(...S)).toBeGreaterThanOrEqual(-1e-12);
        const SV = V.map((row) => row.map((v, j) => v * S[j]));
        expect(maxAbsDiff(multiply(U, transpose(SV))!, A)).toBeLessThan(1e-7);
      }
    }
  });

  it("SVD reconstructs non-square matrices (tall and wide)", () => {
    for (const [r, c] of [[5, 2], [2, 5], [4, 3], [3, 4], [6, 1], [1, 6]]) {
      const A = randMatrix(rng, r, c);
      const { U, S, V } = svd(A);
      const SV = V.map((row) => row.map((v, j) => v * S[j]));
      expect(maxAbsDiff(multiply(U, transpose(SV))!, A)).toBeLessThan(1e-7);
    }
  });

  it("general eigenvalues: Σλ = trace and Πλ = det", () => {
    for (const n of SIZES) {
      for (let it = 0; it < PER_SIZE; it++) {
        const A = randMatrix(rng, n);
        const eig = eigenvaluesGeneral(A)!;
        expect(eig).toHaveLength(n);
        const sumRe = eig.reduce((s, c) => s + c.re, 0);
        const sumIm = eig.reduce((s, c) => s + c.im, 0);
        expect(sumRe).toBeCloseTo(trace(A), 5);
        expect(Math.abs(sumIm)).toBeLessThan(1e-6);
        let prod: Complex = { re: 1, im: 0 };
        for (const c of eig) prod = cMul(prod, c);
        const det = determinant(A)!;
        // relative tolerance — products of ~5 numbers can be large
        const scale = Math.max(1, Math.abs(det));
        expect(Math.abs(prod.re - det) / scale).toBeLessThan(1e-5);
        expect(Math.abs(prod.im) / scale).toBeLessThan(1e-5);
      }
    }
  });

  it("symmetric eigenvalues agree with the general solver", () => {
    for (const n of SIZES) {
      for (let it = 0; it < PER_SIZE; it++) {
        const R = randMatrix(rng, n);
        const A = R.map((row, i) => row.map((_, j) => (R[i][j] + R[j][i]) / 2)); // symmetrize
        const sym = eigenSymmetric(A)!.values.slice().sort((a, b) => a - b);
        const gen = eigenvaluesGeneral(A)!;
        expect(gen.every((c) => Math.abs(c.im) < 1e-6)).toBe(true); // all real
        const genRe = gen.map((c) => c.re).sort((a, b) => a - b);
        for (let i = 0; i < n; i++) expect(genRe[i]).toBeCloseTo(sym[i], 5);
      }
    }
  });

  it("inverse and solve: A·inv(A)=I and A·x=b for well-conditioned A", () => {
    for (const n of SIZES) {
      for (let it = 0; it < PER_SIZE; it++) {
        const A = randMatrix(rng, n);
        const det = determinant(A)!;
        if (Math.abs(det) < 1e-2) continue; // skip near-singular draws
        const inv = inverse(A)!;
        expect(maxAbsDiff(multiply(A, inv)!, identity(n))).toBeLessThan(1e-6);
        expect(rank(A)).toBe(n);
        const b = randMatrix(rng, n, 1);
        const x = solve(A, b)!;
        expect(maxAbsDiff(multiply(A, x)!, b)).toBeLessThan(1e-6);
      }
    }
  });
});

describe("linear-algebra degenerate edge cases", () => {
  it("zero matrix: rank 0, det 0, no inverse, eigenvalues all 0", () => {
    const Z = [
      [0, 0],
      [0, 0],
    ];
    expect(rank(Z)).toBe(0);
    expect(determinant(Z)).toBe(0);
    expect(inverse(Z)).toBeNull();
    const eig = eigenvaluesGeneral(Z)!;
    expect(eig.every((c) => Math.abs(c.re) < 1e-9 && Math.abs(c.im) < 1e-9)).toBe(true);
    const { S } = svd(Z);
    expect(S.every((s) => Math.abs(s) < 1e-9)).toBe(true);
  });

  it("1x1 matrix", () => {
    expect(eigenvaluesGeneral([[7]])![0].re).toBeCloseTo(7, 9);
    expect(determinant([[7]])).toBe(7);
    expect(inverse([[4]])).toEqual([[0.25]]);
    const { Q, R } = qrDecompose([[5]]);
    expect(maxAbsDiff(multiply(Q, R)!, [[5]])).toBeLessThan(1e-9);
    expect(svd([[-3]]).S[0]).toBeCloseTo(3, 9);
  });

  it("singular (rank-deficient) matrix: det 0, no inverse, correct rank", () => {
    const A = [
      [1, 2, 3],
      [2, 4, 6],
      [1, 1, 1],
    ];
    expect(determinant(A)).toBe(0);
    expect(inverse(A)).toBeNull();
    expect(solve(A, [[1], [2], [3]])).toBeNull();
    expect(rank(A)).toBe(2);
    // SVD still works and gives a (near-)zero singular value
    const { S } = svd(A);
    expect(Math.min(...S)).toBeLessThan(1e-9);
  });

  it("known complex spectrum: companion of x^2+1 and a 3x3 with a complex pair", () => {
    const rot = eigenvaluesGeneral([
      [0, -1],
      [1, 0],
    ])!;
    expect(rot.map((c) => Math.abs(c.im)).sort()).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6)]);
    // block-diagonal: real 2 plus rotation → {2, ±i}
    const M = [
      [2, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ];
    const e = eigenvaluesGeneral(M)!;
    const real = e.filter((c) => Math.abs(c.im) < 1e-6);
    const complex = e.filter((c) => Math.abs(c.im) >= 1e-6);
    expect(real).toHaveLength(1);
    expect(real[0].re).toBeCloseTo(2, 6);
    expect(complex).toHaveLength(2);
  });
});

describe("insights edge cases", () => {
  it("constant column → no correlation crash (r undefined)", () => {
    const rep = analyzeData("x,y\n5,1\n5,2\n5,3\n5,4")!;
    // x is constant → any correlation with it is undefined and must be dropped, not NaN
    expect(rep.correlations.every((c) => Number.isFinite(c.r))).toBe(true);
  });
  it("all-missing column does not crash", () => {
    const rep = analyzeData("a,b\n1,\n2,\n3,\n4,")!;
    expect(rep).not.toBeNull();
    const b = rep.columns.find((c) => c.name === "b")!;
    expect(b.n).toBe(0);
  });
  it("single data row is handled", () => {
    const rep = analyzeData("x,y\n1,2")!;
    expect(rep.table.rowCount).toBe(1);
    expect(rep.correlations).toHaveLength(0);
  });
  it("correlate rejects <3 points and infinite/constant input", () => {
    expect(correlate("a", "b", [1, 2], [3, 4])).toBeNull();
    expect(correlate("a", "b", [1, 1, 1], [2, 3, 4])).toBeNull(); // zero variance
  });
  it("perfect correlation gives finite p (r=1 does not divide by zero)", () => {
    const c = correlate("x", "y", [1, 2, 3, 4, 5], [2, 4, 6, 8, 10])!;
    expect(Number.isFinite(c.p)).toBe(true);
    expect(c.r).toBeCloseTo(1, 9);
  });
  it("mixed numeric/text column classification", () => {
    expect(summarizeColumn("g", ["1", "2", "x", "3", "4"]).type).toBe("numeric"); // 80% numeric
    expect(summarizeColumn("g", ["a", "b", "1", "c", "d"]).type).toBe("categorical");
  });
  it("ragged / messy whitespace table parses", () => {
    const t = parseTable("a  b   c\n1 2 3\n4  5   6");
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rowCount).toBe(2);
  });
});

describe("matrix expression edge cases", () => {
  const env = parseDefinitions("A = 1 2; 3 4\nB = 2 0; 0 2\nv = 1; 2");
  if (!env.ok) throw new Error(env.error);
  const E = (s: string) => evalMatrixExpression(s, env.env);

  it("rejects malformed expressions instead of throwing", () => {
    for (const bad of ["A +", "* A", "A B", "(A", "inv(A", "A ** B", "@A", "A + + B"]) {
      const r = E(bad);
      expect(r.ok).toBe(false);
    }
  });
  it("dimension mismatch in add and multiply", () => {
    expect(E("A + v").ok).toBe(false); // 2x2 + 2x1
    expect(E("v * A").ok).toBe(false); // 2x1 * 2x2 inner mismatch
  });
  it("scalar/matrix mixing rules", () => {
    expect(E("A + 3").ok).toBe(false); // can't add scalar to matrix
    const s = E("2 * A");
    expect(s.ok && s.value.kind === "matrix").toBe(true);
    const d = E("det(A) + trace(B)"); // scalar + scalar
    expect(d.ok && d.value.kind === "scalar" && d.value.s).toBeCloseTo(-2 + 4, 9);
  });
  it("singular inverse is reported", () => {
    const sing = parseDefinitions("S = 1 2; 2 4");
    if (!sing.ok) throw new Error(sing.error);
    const r = evalMatrixExpression("inv(S)", sing.env);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.toLowerCase()).toContain("singular");
  });
  it("chained transpose and precedence", () => {
    const r = E("A''"); // transpose twice = A
    expect(r.ok && r.value.kind === "matrix" && r.value.m).toEqual([
      [1, 2],
      [3, 4],
    ]);
    // multiplication binds tighter than addition
    const p = E("A + B * B");
    expect(p.ok && p.value.kind === "matrix" && p.value.m).toEqual([
      [5, 2],
      [3, 8],
    ]);
  });
  it("division by scalar and division-by-zero", () => {
    const r = E("A / 2");
    expect(r.ok && r.value.kind === "matrix" && r.value.m[0][0]).toBe(0.5);
    const z = E("A / 0");
    // divides to Infinity — should not throw; caller guards on non-finite display
    expect(z.ok).toBe(true);
  });
});
