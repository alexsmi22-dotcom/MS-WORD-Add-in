// Dedicated tests for matrixExpr.ts — the one-line matrix expression evaluator.
//
// The oracles are algebraic identities rather than transcribed results:
// A·inv(A) = I, (A')' = A, det(AB) = det(A)det(B). An evaluator with its
// operator precedence or its transpose convention wrong still returns a
// well-formed matrix of the right shape, which is exactly the failure that
// looks like a correct answer.

import { parseDefinitions, evalMatrixExpression } from "../matrixExpr";
import type { Matrix } from "../linalg";

function env(text: string): Record<string, Matrix> {
  const r = parseDefinitions(text);
  if (!r.ok) throw new Error(r.error);
  return r.env;
}

function matrix(expr: string, e: Record<string, Matrix>): Matrix {
  const r = evalMatrixExpression(expr, e);
  if (!r.ok) throw new Error(`${expr}: ${r.error}`);
  if (r.value.kind !== "matrix") throw new Error(`${expr}: expected a matrix, got a scalar`);
  return r.value.m;
}

function scalar(expr: string, e: Record<string, Matrix>): number {
  const r = evalMatrixExpression(expr, e);
  if (!r.ok) throw new Error(`${expr}: ${r.error}`);
  if (r.value.kind !== "scalar") throw new Error(`${expr}: expected a scalar, got a matrix`);
  return r.value.s;
}

function expectClose(a: Matrix, b: Matrix, tol = 1e-9): void {
  expect({ rows: a.length, cols: a[0]?.length }).toEqual({ rows: b.length, cols: b[0]?.length });
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < a[i].length; j++) expect(Math.abs(a[i][j] - b[i][j])).toBeLessThan(tol);
}

// One definition per LINE; rows within a matrix are separated by semicolons.
const BASE = env("A = 2 1; 1 3\nB = 1 0; 2 1\nC = 1 2 3; 4 5 6");
const I2: Matrix = [
  [1, 0],
  [0, 1],
];

describe("definitions", () => {
  test("named matrices are parsed with their shape", () => {
    expect(BASE.A).toEqual([
      [2, 1],
      [1, 3],
    ]);
    expect(BASE.C.length).toBe(2);
    expect(BASE.C[0].length).toBe(3);
  });

  test("a ragged definition is refused rather than padded", () => {
    const r = parseDefinitions("A = 1 2; 3");
    expect(r.ok).toBe(false);
  });
});

describe("algebraic identities", () => {
  test("A times its inverse is the identity", () => {
    expectClose(matrix("A*inv(A)", BASE), I2);
    expectClose(matrix("inv(A)*A", BASE), I2);
  });

  test("transposing twice is a no-op", () => {
    expectClose(matrix("(A')'", BASE), BASE.A);
    expectClose(matrix("(C')'", BASE), BASE.C);
  });

  test("addition commutes and subtraction does not", () => {
    expectClose(matrix("A+B", BASE), matrix("B+A", BASE));
    const ab = matrix("A-B", BASE);
    const ba = matrix("B-A", BASE);
    expectClose(
      ab,
      ba.map((row) => row.map((v) => -v)),
    );
  });

  test("multiplication does NOT commute, which the evaluator must respect", () => {
    const ab = matrix("A*B", BASE);
    const ba = matrix("B*A", BASE);
    let differs = false;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (Math.abs(ab[i][j] - ba[i][j]) > 1e-12) differs = true;
    expect(differs).toBe(true);
  });

  test("det(A*B) = det(A)*det(B)", () => {
    const lhs = scalar("det(A*B)", BASE);
    const rhs = scalar("det(A)", BASE) * scalar("det(B)", BASE);
    expect(Math.abs(lhs - rhs)).toBeLessThan(1e-9);
  });

  test("trace is the sum of the diagonal", () => {
    expect(scalar("trace(A)", BASE)).toBeCloseTo(5, 12);
  });

  test("scalar multiplication distributes", () => {
    expectClose(matrix("2*(A+B)", BASE), matrix("2*A+2*B", BASE));
  });

  test("(A*B)' = B'*A' — the order reverses", () => {
    expectClose(matrix("(A*B)'", BASE), matrix("B'*A'", BASE));
  });
});

describe("precedence and grouping", () => {
  test("multiplication binds tighter than addition", () => {
    expectClose(matrix("A+B*A", BASE), matrix("A+(B*A)", BASE));
  });

  test("parentheses override it", () => {
    const grouped = matrix("(A+B)*A", BASE);
    const ungrouped = matrix("A+B*A", BASE);
    let differs = false;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) if (Math.abs(grouped[i][j] - ungrouped[i][j]) > 1e-12) differs = true;
    expect(differs).toBe(true);
  });
});

describe("refusals name the problem", () => {
  test("shapes that cannot multiply are refused", () => {
    const r = evalMatrixExpression("C*A", BASE); // 2x3 times 2x2
    expect(r.ok).toBe(false);
  });

  test("shapes that cannot add are refused", () => {
    const r = evalMatrixExpression("A+C", BASE);
    expect(r.ok).toBe(false);
  });

  test("inverting a singular matrix is refused, not fudged", () => {
    const e = env("S = 1 2; 2 4");
    const r = evalMatrixExpression("inv(S)", e);
    expect(r.ok).toBe(false);
  });

  test("an unknown name is refused rather than treated as zero", () => {
    const r = evalMatrixExpression("A*Z", BASE);
    expect(r.ok).toBe(false);
  });

  test("malformed input is refused", () => {
    for (const bad of ["A*", "(A+B", "", "*A"]) {
      expect(evalMatrixExpression(bad, BASE).ok).toBe(false);
    }
  });

  test("a non-square determinant is refused", () => {
    expect(evalMatrixExpression("det(C)", BASE).ok).toBe(false);
  });
});
