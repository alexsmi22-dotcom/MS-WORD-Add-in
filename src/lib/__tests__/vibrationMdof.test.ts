// Oracle tests for MULTI-DEGREE-OF-FREEDOM forced response.
//
// Modal superposition is easy to get subtly wrong — a transposed mode matrix, a
// dropped mass-normalisation, a sign on the phase — and every one of those
// errors still produces plausible numbers. So none of the checks here compare
// against modal superposition done a second time. They compare against solvers
// that share no code with it:
//
//   1. n = 1 must reproduce `forcedResponse`, the SDOF path that has been
//      shipping and tested independently.
//   2. UNDAMPED, the steady-state amplitude is the solution of the real system
//      (K - w^2*M)x = F. That is a direct linear solve with no modes in it at
//      all, and it pins the mode matrix orientation and normalisation together.
//   3. DAMPED with Rayleigh damping, it is the solution of the COMPLEX system
//      (K - w^2*M + j*w*C)x = F with C = alpha*M + beta*K formed explicitly.
//      This is the check that would catch a wrong modal damping ratio, since
//      the C matrix is built without reference to the mode shapes.

import { modalForcedResponse, rayleighDamping, modalAnalysis, forcedResponse, chainSystem } from "../vibration";
import { solve, Matrix } from "../linalg";

const near = (a: number, b: number, tol = 1e-8) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

function okRes(r: ReturnType<typeof modalForcedResponse>) {
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}

/** Undamped oracle: solve (K - w^2 M) x = F directly. */
function undampedDirect(M: Matrix, K: Matrix, F: number[], w: number): number[] {
  const n = M.length;
  const A: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => K[i][j] - w * w * M[i][j]),
  );
  const x = solve(A, F.map((v) => [v]));
  if (!x) throw new Error("oracle system is singular");
  return x.map((row) => row[0]);
}

/**
 * Damped oracle: solve (K - w^2 M + j w C) x = F over the complex numbers, by
 * the standard 2n real embedding [[Re, -Im], [Im, Re]]. No modes involved.
 */
function dampedDirect(M: Matrix, K: Matrix, C: Matrix, F: number[], w: number): { amp: number[]; phase: number[] } {
  const n = M.length;
  const Re: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => K[i][j] - w * w * M[i][j]),
  );
  const Im: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => w * C[i][j]));
  const big: Matrix = Array.from({ length: 2 * n }, () => new Array(2 * n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      big[i][j] = Re[i][j];
      big[i][j + n] = -Im[i][j];
      big[i + n][j] = Im[i][j];
      big[i + n][j + n] = Re[i][j];
    }
  const rhs = [...F.map((v) => [v]), ...new Array(n).fill(0).map(() => [0])];
  const x = solve(big, rhs);
  if (!x) throw new Error("oracle system is singular");
  const amp: number[] = [];
  const phase: number[] = [];
  for (let i = 0; i < n; i++) {
    const re = x[i][0];
    const im = x[i + n][0];
    amp.push(Math.hypot(re, im));
    phase.push((Math.atan2(-im, re) * 180) / Math.PI);
  }
  return { amp, phase };
}

// ---------------------------------------------------------------------------

describe("one degree of freedom reproduces the SDOF engine", () => {
  const m = 2,
    k = 800,
    c = 12,
    f0 = 50;
  const zeta = c / (2 * Math.sqrt(k * m));

  for (const w of [0, 5, 19, 20, 25, 40]) {
    test(`amplitude and phase match forcedResponse at omega = ${w}`, () => {
      const sdof = forcedResponse(m, k, c, f0, w);
      if (!sdof.ok) throw new Error(sdof.error);
      const r = okRes(modalForcedResponse([[m]], [[k]], [f0], w, zeta));
      near(r.amplitude[0], sdof.amplitude, 1e-9);
      near(r.phaseDeg[0], sdof.phaseDeg, 1e-9);
      near(r.frequencies[0], Math.sqrt(k / m), 1e-12);
    });
  }
});

describe("undamped MDOF matches the direct linear solve", () => {
  const built = chainSystem([2, 1, 3], [400, 300, 500], true);
  if ("ok" in built) throw new Error("chain failed");
  const { M, K } = built;
  const F = [100, 0, -40];

  for (const w of [0, 3, 7.5, 14, 22, 30]) {
    test(`omega = ${w}`, () => {
      const oracle = undampedDirect(M, K, F, w);
      const r = okRes(modalForcedResponse(M, K, F, w, 0));
      for (let j = 0; j < 3; j++) {
        near(r.amplitude[j], Math.abs(oracle[j]), 1e-7);
        // Undamped response is in phase (0) or exactly out of phase (180).
        const expected = oracle[j] >= 0 ? 0 : 180;
        expect(Math.abs(Math.abs(r.phaseDeg[j]) - expected)).toBeLessThan(1e-6);
      }
    });
  }
});

describe("Rayleigh-damped MDOF matches the direct complex solve", () => {
  const built = chainSystem([2, 1, 3], [400, 300, 500], true);
  if ("ok" in built) throw new Error("chain failed");
  const { M, K } = built;
  const F = [100, 0, -40];
  const alpha = 0.6,
    beta = 0.002;
  const C: Matrix = M.map((row, i) => row.map((v, j) => alpha * v + beta * K[i][j]));

  const modal = modalAnalysis(M, K);
  if (!modal.ok) throw new Error(modal.error);
  const zetas = rayleighDamping(alpha, beta, modal.frequencies);

  for (const w of [2, 9, 14.2, 21, 33]) {
    test(`omega = ${w}`, () => {
      const oracle = dampedDirect(M, K, C, F, w);
      const r = okRes(modalForcedResponse(M, K, F, w, zetas));
      for (let j = 0; j < 3; j++) {
        near(r.amplitude[j], oracle.amp[j], 1e-6);
        expect(Math.abs(r.phaseDeg[j] - oracle.phase[j])).toBeLessThan(1e-4);
      }
    });
  }

  test("the Rayleigh ratios are not equal across modes — that is the point of the note", () => {
    expect(zetas[0]).not.toBeCloseTo(zetas[1], 4);
    // alpha damps the low mode, beta the high one, so the curve dips in between.
    expect(Math.min(...zetas)).toBeLessThan(zetas[0]);
    expect(Math.min(...zetas)).toBeLessThan(zetas[2]);
  });

  test("driving right at a resonance is finite and dominated by that mode", () => {
    const w = modal.frequencies[1];
    const r = okRes(modalForcedResponse(M, K, F, w, zetas));
    expect(r.dominantMode).toBe(2);
    expect(r.contributions[1].share).toBeGreaterThan(0.7);
    expect(r.notes.join(" ")).toMatch(/EVERY natural frequency is a resonance/i);
    const oracle = dampedDirect(M, K, C, F, w);
    for (let j = 0; j < 3; j++) near(r.amplitude[j], oracle.amp[j], 1e-6);
  });
});

describe("a load at a node cannot excite that mode", () => {
  // A genuinely SYMMETRIC two-mass system — ground-spring, coupling spring,
  // ground-spring — written out rather than built by chainSystem, whose
  // "grounded" chain is anchored at one end only. Mode 1 is symmetric (both
  // masses together, w^2 = k), mode 2 antisymmetric (w^2 = 3k). An equal force
  // on both masses does no work on the antisymmetric mode, so mode 2 must not
  // respond at all.
  const M: Matrix = [
    [1, 0],
    [0, 1],
  ];
  const K: Matrix = [
    [200, -100],
    [-100, 200],
  ];

  test("the symmetric load leaves the antisymmetric mode completely unexcited", () => {
    const r = okRes(modalForcedResponse(M, K, [10, 10], 5, 0.02));
    expect(Math.abs(r.contributions[1].force)).toBeLessThan(1e-9);
    expect(r.contributions[1].amplitude).toBeLessThan(1e-9);
    expect(r.dominantMode).toBe(1);
    expect(r.notes.join(" ")).toMatch(/node of a\s+mode cannot excite/i);
  });

  test("an antisymmetric load flips which mode responds", () => {
    const r = okRes(modalForcedResponse(M, K, [10, -10], 5, 0.02));
    expect(Math.abs(r.contributions[0].force)).toBeLessThan(1e-9);
    expect(r.dominantMode).toBe(2);
  });

  test("undamped resonance on an unexcited mode is reported, not refused", () => {
    // Driving exactly at mode 2 with zero damping, but the load is at its node:
    // there is no singularity because the mode is never excited.
    const modal = modalAnalysis(M, K);
    if (!modal.ok) throw new Error(modal.error);
    const r = modalForcedResponse(M, K, [10, 10], modal.frequencies[1], 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notes.join(" ")).toMatch(/applied at a NODE/i);
  });
});

describe("refusals", () => {
  const M: Matrix = [
    [1, 0],
    [0, 1],
  ];
  const K: Matrix = [
    [200, -100],
    [-100, 200],
  ];

  test("undamped driving exactly at a resonance has no steady state and says so", () => {
    const modal = modalAnalysis(M, K);
    if (!modal.ok) throw new Error(modal.error);
    const r = modalForcedResponse(M, K, [10, 0], modal.frequencies[0], 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/grows without bound|no\s+steady state/i);
  });

  test("a rigid-body mode driven at zero frequency is refused with the physical reason", () => {
    const free = chainSystem([1, 1], [100], false);
    if ("ok" in free) throw new Error("chain failed");
    const r = modalForcedResponse(free.M, free.K, [10, 0], 0, 0.02);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/rigid-body/i);
  });

  test("a free-free structure at non-zero frequency is fine", () => {
    const free = chainSystem([1, 1], [100], false);
    if ("ok" in free) throw new Error("chain failed");
    expect(modalForcedResponse(free.M, free.K, [10, 0], 5, 0.02).ok).toBe(true);
  });

  test("a force vector of the wrong length is refused", () => {
    const r = modalForcedResponse(M, K, [1, 2, 3], 5, 0.02);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/degrees of freedom/i);
  });

  test("a wrong-length damping list is refused rather than padded", () => {
    const r = modalForcedResponse(M, K, [1, 2], 5, [0.02, 0.03, 0.04]);
    expect(r.ok).toBe(false);
  });

  test("negative damping is refused", () => {
    expect(modalForcedResponse(M, K, [1, 2], 5, -0.1).ok).toBe(false);
  });

  test("a negative forcing frequency is refused", () => {
    expect(modalForcedResponse(M, K, [1, 2], -5, 0.02).ok).toBe(false);
  });

  test("the classical-damping assumption is always stated", () => {
    const r = okRes(modalForcedResponse(M, K, [1, 2], 5, 0.02));
    expect(r.notes.join(" ")).toMatch(/CLASSICAL DAMPING/);
  });
});
