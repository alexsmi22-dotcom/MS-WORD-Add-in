import {
  qrDecompose,
  svd,
  eigenvaluesGeneral,
  formatComplex,
  multiply,
  transpose,
  identity,
} from "../linalg";
import { parseDefinitions, evalMatrixExpression } from "../matrixExpr";

function closeMatrix(a: number[][], b: number[][], dp = 6): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i].length).toBe(b[i].length);
    for (let j = 0; j < a[i].length; j++) expect(a[i][j]).toBeCloseTo(b[i][j], dp);
  }
}

describe("QR decomposition", () => {
  it("factors A = Q·R with Q orthogonal and R upper-triangular", () => {
    const A = [
      [12, -51, 4],
      [6, 167, -68],
      [-4, 24, -41],
    ];
    const { Q, R } = qrDecompose(A);
    // Q·R reconstructs A
    closeMatrix(multiply(Q, R)!, A, 6);
    // Qᵀ·Q = I
    closeMatrix(multiply(transpose(Q), Q)!, identity(3), 6);
    // R is upper-triangular
    for (let i = 0; i < 3; i++) for (let j = 0; j < i; j++) expect(Math.abs(R[i][j])).toBeLessThan(1e-9);
  });
});

describe("SVD", () => {
  it("reconstructs a square matrix and gives descending non-negative singular values", () => {
    const A = [
      [3, 0],
      [0, -2],
    ];
    const { U, S, V } = svd(A);
    expect(S[0]).toBeGreaterThanOrEqual(S[1]);
    expect(S[0]).toBeCloseTo(3, 6);
    expect(S[1]).toBeCloseTo(2, 6);
    // A ≈ U·diag(S)·Vᵀ
    const SV = V.map((row) => row.map((v, j) => v * S[j]));
    closeMatrix(multiply(U, transpose(SV))!, A, 6);
  });
  it("reconstructs a non-square (tall) matrix", () => {
    const A = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    const { U, S, V } = svd(A);
    const SV = V.map((row) => row.map((v, j) => v * S[j]));
    closeMatrix(multiply(U, transpose(SV))!, A, 5);
  });
  it("reconstructs a non-square (wide) matrix", () => {
    const A = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const { U, S, V } = svd(A);
    const SV = V.map((row) => row.map((v, j) => v * S[j]));
    closeMatrix(multiply(U, transpose(SV))!, A, 5);
  });
});

describe("general eigenvalues", () => {
  const sortC = (cs: { re: number; im: number }[]) =>
    [...cs].sort((a, b) => a.re - b.re || a.im - b.im);

  it("finds real eigenvalues of a diagonal matrix", () => {
    const e = sortC(eigenvaluesGeneral([
      [2, 0],
      [0, 3],
    ])!);
    expect(e[0].re).toBeCloseTo(2, 6);
    expect(e[1].re).toBeCloseTo(3, 6);
    expect(e[0].im).toBeCloseTo(0, 8);
  });

  it("reads eigenvalues off a triangular matrix", () => {
    const e = sortC(eigenvaluesGeneral([
      [1, 2, 3],
      [0, 4, 5],
      [0, 0, 6],
    ])!);
    expect(e.map((c) => c.re)).toEqual([expect.closeTo(1, 6), expect.closeTo(4, 6), expect.closeTo(6, 6)]);
  });

  it("finds a complex-conjugate pair (rotation matrix → ±i)", () => {
    const e = eigenvaluesGeneral([
      [0, -1],
      [1, 0],
    ])!;
    expect(e[0].re).toBeCloseTo(0, 6);
    expect(e[1].re).toBeCloseTo(0, 6);
    expect(Math.abs(e[0].im)).toBeCloseTo(1, 6);
    expect(e[0].im).toBeCloseTo(-e[1].im, 6);
  });

  it("matches a known non-symmetric 2x2 with real eigenvalues", () => {
    // [[2,1],[1,2]] → 1, 3 ; but non-symmetric [[4,1],[2,3]] → 5,2
    const e = sortC(eigenvaluesGeneral([
      [4, 1],
      [2, 3],
    ])!);
    expect(e[0].re).toBeCloseTo(2, 6);
    expect(e[1].re).toBeCloseTo(5, 6);
  });

  it("returns null for a non-square matrix", () => {
    expect(eigenvaluesGeneral([[1, 2, 3]])).toBeNull();
  });
});

describe("formatComplex", () => {
  it("renders real, imaginary, and full complex forms", () => {
    expect(formatComplex({ re: 3, im: 0 })).toBe("3");
    expect(formatComplex({ re: 0, im: 1 })).toBe("i");
    expect(formatComplex({ re: 0, im: -1 })).toBe("-i");
    expect(formatComplex({ re: 2, im: 3 })).toBe("2 + 3i");
    expect(formatComplex({ re: 2, im: -3 })).toBe("2 - 3i");
  });
});

describe("matrix expression evaluator", () => {
  const env = parseDefinitions("A = 1 2; 3 4\nB = 5 6; 7 8\nC = 1 0; 0 1");
  if (!env.ok) throw new Error(env.error);

  const evalM = (expr: string) => evalMatrixExpression(expr, env.env);

  it("parses definitions", () => {
    expect(env.env.A).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("adds and multiplies matrices", () => {
    const r = evalM("A + B");
    expect(r.ok && r.value.kind === "matrix" && r.value.m).toEqual([
      [6, 8],
      [10, 12],
    ]);
    const p = evalM("A * B");
    expect(p.ok && p.value.kind === "matrix" && p.value.m).toEqual([
      [19, 22],
      [43, 50],
    ]);
  });

  it("handles scalar multiply, transpose, and inv", () => {
    const r = evalM("2 * C'");
    expect(r.ok && r.value.kind === "matrix" && r.value.m).toEqual([
      [2, 0],
      [0, 2],
    ]);
    const inv = evalM("A * inv(A)");
    if (inv.ok && inv.value.kind === "matrix") closeMatrix(inv.value.m, identity(2), 6);
    else throw new Error("expected matrix");
  });

  it("evaluates det and trace to scalars", () => {
    const d = evalM("det(A)");
    expect(d.ok && d.value.kind === "scalar" && d.value.s).toBeCloseTo(-2, 6);
    const t = evalM("trace(B)");
    expect(t.ok && t.value.kind === "scalar" && t.value.s).toBe(13);
  });

  it("reports dimension errors and unknown names", () => {
    const bad = evalMatrixExpression("A + D", env.env);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("Unknown matrix");
    const mm = parseDefinitions("A = 1 2; 3 4\nR = 1 2 3");
    if (!mm.ok) throw new Error(mm.error);
    const dim = evalMatrixExpression("A + R", mm.env);
    expect(dim.ok).toBe(false);
  });

  it("respects precedence and parentheses", () => {
    const r = evalM("(A + B) * C");
    expect(r.ok && r.value.kind === "matrix" && r.value.m).toEqual([
      [6, 8],
      [10, 12],
    ]);
  });
});
