// "Is there a rigid-body mode?" must be asked of the STIFFNESS MATRIX, not of
// the eigenvalues.
//
// Two tolerances got this wrong in succession, and the decision is not cosmetic:
// classifying a mode as rigid-body DELETES it, forcing its eigenvalue and its
// frequency to zero.
//
//   1e-9  relative to the largest eigenvalue — seven orders looser than the
//         eigensolve's own rounding. Any spread past 1e9 lost its lowest mode.
//   1e-12 moved the cliff out three orders and did not remove it.
//
// The case below is the one that survived the second attempt, and nothing about
// it is exotic: two 10-tonne floors on ordinary columns, plus a 0.1 mg sensor die
// on a stiff bond. It reported [0, 0, 1e8] where the truth is 6.3 and 17.3 rad/s
// — about 1 Hz and 2.8 Hz — refused the static case as "the whole structure
// accelerates away", and missed BOTH real resonances.
//
// The reason no tolerance works: lambda_min / lambda_max carries no rank
// information. Cholesky does — it succeeds exactly when the matrix is positive
// definite, which for a stiffness matrix means exactly that no rigid-body mode
// exists.

import { modalAnalysis, modalForcedResponse, chainSystem } from "../vibration";
import { solve, Matrix } from "../linalg";

const near = (a: number, b: number, tol = 1e-6) =>
  expect(Math.abs(a - b) / Math.max(1e-12, Math.abs(b))).toBeLessThan(tol);

describe("a grounded chain never has a rigid-body mode, however wide the spread", () => {
  // K = B^T diag(k) B with B unit lower-bidiagonal, hence nonsingular, hence K is
  // strictly positive definite for any k > 0. That is a proof, not a tolerance.
  const sys = chainSystem([1e4, 1e4, 1e-7], [1e6, 1.2e6, 1e9], true);
  if ("ok" in sys) throw new Error("chain failed");

  test("the two floor modes are found, not zeroed", () => {
    const m = modalAnalysis(sys.M, sys.K);
    if (!m.ok) throw new Error(m.error);
    // The two floors alone give trace 340, product 1.2e4 -> lambda = 40, 300.
    near(m.frequencies[0], Math.sqrt(40), 1e-4);
    near(m.frequencies[1], Math.sqrt(300), 1e-4);
    expect(m.frequencies[2]).toBeGreaterThan(1e7);
    expect(m.notes.join(" ")).not.toMatch(/RIGID-BODY/i);
  });

  test("the static case is solved, not refused", () => {
    const truth = solve(sys.K, [[1], [0], [0]]);
    if (!truth) throw new Error("singular");
    const r = modalForcedResponse(sys.M, sys.K, [1, 0, 0], 0, 0.02);
    expect(r.ok).toBe(true);
    if (r.ok) for (let i = 0; i < 3; i++) near(r.amplitude[i], Math.abs(truth[i][0]), 1e-6);
  });

  test("the forced response matches a direct complex solve", () => {
    const alpha = 0.4;
    const C: Matrix = sys.M.map((row) => row.map((v) => alpha * v));
    for (const w of [1, 3, Math.sqrt(40), Math.sqrt(300)]) {
      const n = 3;
      const big: Matrix = Array.from({ length: 2 * n }, () => new Array(2 * n).fill(0));
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const re = sys.K[i][j] - w * w * sys.M[i][j];
          const im = w * C[i][j];
          big[i][j] = re;
          big[i][j + n] = -im;
          big[i + n][j] = im;
          big[i + n][j + n] = re;
        }
      const x = solve(big, [[1], [0], [0], [0], [0], [0]]);
      if (!x) continue;
      const oracle = Array.from({ length: n }, (_, i) => Math.hypot(x[i][0], x[i + n][0]));
      const r = modalForcedResponse(sys.M, sys.K, [1, 0, 0], w, { alpha, beta: 0 });
      if (!r.ok) throw new Error(`refused at w=${w}: ${r.error}`);
      for (let i = 0; i < n; i++) near(r.amplitude[i], oracle[i], 1e-5);
    }
  });

  test("a wide spread does not invent a rigid-body mode at any scale", () => {
    for (const kDie of [1e6, 1e8, 1e10, 1e12, 1e14, 1e16]) {
      const s = chainSystem([1e4, 1e-7], [1e6, kDie], true);
      if ("ok" in s) throw new Error("chain failed");
      const m = modalAnalysis(s.M, s.K);
      if (!m.ok) throw new Error(m.error);
      expect({ kDie, zeroed: m.frequencies[0] === 0 }).toEqual({ kDie, zeroed: false });
      // lambda1 * lambda2 = det(K)/det(M) is an independent check.
      const detK = s.K[0][0] * s.K[1][1] - s.K[0][1] * s.K[1][0];
      const detM = s.M[0][0] * s.M[1][1];
      near(m.frequencies[0] * m.frequencies[1], Math.sqrt(detK / detM), 1e-5);
    }
  });
});

describe("a genuinely unrestrained structure is still recognised", () => {
  test("a free-free chain reports its rigid-body mode", () => {
    for (const n of [2, 3, 5, 8]) {
      const masses = Array.from({ length: n }, (_, i) => 1 + i);
      const springs = Array.from({ length: n - 1 }, () => 100);
      const free = chainSystem(masses, springs, false);
      if ("ok" in free) throw new Error("chain failed");
      const m = modalAnalysis(free.M, free.K);
      if (!m.ok) throw new Error(m.error);
      expect({ n, first: m.frequencies[0] }).toEqual({ n, first: 0 });
      expect(m.notes.join(" ")).toMatch(/RIGID-BODY/i);
    }
  });

  test("a free-free structure at wildly different scales is still recognised", () => {
    for (const k of [1e-6, 1, 1e6, 1e12]) {
      for (const m0 of [1e-6, 1, 1e6]) {
        const free = chainSystem([m0, m0 * 1e3], [k], false);
        if ("ok" in free) throw new Error("chain failed");
        const r = modalAnalysis(free.M, free.K);
        if (!r.ok) throw new Error(r.error);
        expect({ k, m0, first: r.frequencies[0] }).toEqual({ k, m0, first: 0 });
      }
    }
  });

  test("an all-zero stiffness matrix is entirely rigid-body", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [0, 0],
      [0, 0],
    ];
    const r = modalAnalysis(M, K);
    if (!r.ok) throw new Error(r.error);
    expect(r.frequencies).toEqual([0, 0]);
  });
});
