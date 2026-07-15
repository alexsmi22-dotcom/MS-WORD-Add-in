import {
  parseMatrix,
  multiply,
  transpose,
  trace,
  determinant,
  inverse,
  solve,
  rank,
  identity,
  isSymmetric,
  eigenSymmetric,
  formatMatrix,
} from "../linalg";

function mat(text: string): number[][] {
  const p = parseMatrix(text);
  if (!p.ok) throw new Error(p.error);
  return p.matrix;
}

describe("parseMatrix", () => {
  it("parses rows by newline/semicolon and cells by comma/space", () => {
    expect(mat("1 2\n3 4")).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(mat("1, 2; 3, 4")).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
  it("rejects ragged rows and non-numbers", () => {
    expect(parseMatrix("1 2\n3").ok).toBe(false);
    expect(parseMatrix("1 x\n3 4").ok).toBe(false);
    expect(parseMatrix("   ").ok).toBe(false);
  });
});

describe("basic ops", () => {
  it("multiplies conformable matrices and rejects non-conformable", () => {
    const a = [
      [1, 2],
      [3, 4],
    ];
    const b = [
      [5, 6],
      [7, 8],
    ];
    expect(multiply(a, b)).toEqual([
      [19, 22],
      [43, 50],
    ]);
    expect(multiply(a, [[1, 2, 3]])).toBeNull();
  });
  it("transposes and traces", () => {
    expect(transpose([[1, 2, 3]])).toEqual([[1], [2], [3]]);
    expect(
      trace([
        [1, 9],
        [9, 5],
      ]),
    ).toBe(6);
  });
});

describe("determinant", () => {
  it("matches known 2x2 and 3x3 values", () => {
    expect(
      determinant([
        [1, 2],
        [3, 4],
      ]),
    ).toBeCloseTo(-2, 10);
    // det of a singular matrix is exactly 0
    expect(
      determinant([
        [2, 4],
        [1, 2],
      ]),
    ).toBe(0);
    expect(
      determinant([
        [6, 1, 1],
        [4, -2, 5],
        [2, 8, 7],
      ]),
    ).toBeCloseTo(-306, 8);
  });
  it("is null for non-square", () => {
    expect(determinant([[1, 2, 3]])).toBeNull();
  });
});

describe("inverse", () => {
  it("inverts and round-trips to the identity", () => {
    const a = [
      [4, 7],
      [2, 6],
    ];
    const inv = inverse(a)!;
    expect(inv).not.toBeNull();
    const prod = multiply(a, inv)!;
    expect(prod[0][0]).toBeCloseTo(1, 10);
    expect(prod[0][1]).toBeCloseTo(0, 10);
    expect(prod[1][0]).toBeCloseTo(0, 10);
    expect(prod[1][1]).toBeCloseTo(1, 10);
  });
  it("returns null for a singular matrix", () => {
    expect(
      inverse([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });
});

describe("solve", () => {
  it("solves a well-posed system (accepts row or column b)", () => {
    // 2x + y = 5 ; x - y = 1  -> x=2, y=1
    const A = [
      [2, 1],
      [1, -1],
    ];
    const xCol = solve(A, [[5], [1]])!;
    expect(xCol[0][0]).toBeCloseTo(2, 10);
    expect(xCol[1][0]).toBeCloseTo(1, 10);
    const xRow = solve(A, [[5, 1]])!;
    expect(xRow[0][0]).toBeCloseTo(2, 10);
    expect(xRow[1][0]).toBeCloseTo(1, 10);
  });
  it("returns null for a singular system", () => {
    expect(
      solve(
        [
          [1, 1],
          [1, 1],
        ],
        [[2], [3]],
      ),
    ).toBeNull();
  });
});

describe("rank", () => {
  it("detects full and deficient rank", () => {
    expect(rank(identity(3))).toBe(3);
    expect(
      rank([
        [1, 2, 3],
        [2, 4, 6],
        [1, 0, 1],
      ]),
    ).toBe(2);
  });
});

describe("eigenSymmetric", () => {
  it("returns null for non-symmetric input", () => {
    expect(isSymmetric([[1, 2], [3, 4]])).toBe(false);
    expect(eigenSymmetric([[1, 2], [3, 4]])).toBeNull();
  });
  it("finds eigenvalues of a symmetric matrix (descending)", () => {
    // [[2,0],[0,3]] -> eigenvalues 3,2
    const e = eigenSymmetric([
      [2, 0],
      [0, 3],
    ])!;
    expect(e.values[0]).toBeCloseTo(3, 8);
    expect(e.values[1]).toBeCloseTo(2, 8);
  });
  it("matches a known non-diagonal case", () => {
    // [[2,1],[1,2]] -> eigenvalues 3 and 1
    const e = eigenSymmetric([
      [2, 1],
      [1, 2],
    ])!;
    expect(e.values[0]).toBeCloseTo(3, 8);
    expect(e.values[1]).toBeCloseTo(1, 8);
    // eigenvector for λ=3 is proportional to (1,1); check A v = λ v
    const v = e.vectors.map((r) => r[0]);
    const av = multiply(
      [
        [2, 1],
        [1, 2],
      ],
      [[v[0]], [v[1]]],
    )!;
    expect(av[0][0]).toBeCloseTo(3 * v[0], 6);
    expect(av[1][0]).toBeCloseTo(3 * v[1], 6);
  });
});

describe("formatMatrix", () => {
  it("aligns and trims", () => {
    const s = formatMatrix([
      [1, 20],
      [300, 4],
    ]);
    expect(s.split("\n").length).toBe(2);
  });
});
