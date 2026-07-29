// ADVERSARIAL pass over multi-DOF forced response.
//
// The oracle suite checks hand-picked systems. This one tries to break modal
// superposition on systems nobody designed it for, and the central weapon is a
// RANDOMISED property test: for a hundred pseudo-random mass and stiffness
// matrices, at a spread of frequencies, the modal answer must agree with a
// direct complex linear solve of (K - w^2*M + j*w*C)x = F. That direct solve
// shares no code with the modal path — no eigenvectors, no normalisation, no
// modal coordinates — so agreeing on a system neither of us chose is real
// evidence rather than a restatement.
//
// The generator is a seeded LCG rather than Math.random, because an adversarial
// test that fails one run in twenty and passes on rerun teaches the reader to
// rerun it.
//
// The specific traps aimed at:
//   - REPEATED EIGENVALUES. A symmetric structure has degenerate modes, the
//     eigenvectors in that subspace are not unique, and any code that assumed
//     distinct modes picks an arbitrary basis. The PHYSICAL response must be
//     basis-independent, so it must still be right.
//   - A NON-DIAGONAL MASS MATRIX. A consistent-mass model couples the inertia,
//     which is where a M^-1*K shortcut or a missing mass-normalisation shows up.
//   - OVERDAMPED MODES. zeta > 1 per mode is algebraically fine for a steady
//     state and is exactly where a sqrt(1 - zeta^2) written somewhere by habit
//     would produce NaN.
//   - w = 0. The static answer must be K^-1*F, with damping playing no part.
//   - SIZE. MAX_DOF must return, and quickly: a task pane that does not come
//     back is a frozen Word, not an error.

import { modalForcedResponse, rayleighDamping, modalAnalysis } from "../vibration";
import { solve, Matrix } from "../linalg";

const near = (a: number, b: number, tol = 1e-6) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1e-9, Math.abs(b)));

/** Deterministic LCG, so a failure here reproduces on rerun. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Direct complex solve of (K - w^2 M + j w C) x = F. No modes anywhere. */
function directComplex(M: Matrix, K: Matrix, C: Matrix, F: number[], w: number) {
  const n = M.length;
  const big: Matrix = Array.from({ length: 2 * n }, () => new Array(2 * n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const re = K[i][j] - w * w * M[i][j];
      const im = w * C[i][j];
      big[i][j] = re;
      big[i][j + n] = -im;
      big[i + n][j] = im;
      big[i + n][j + n] = re;
    }
  const rhs = [...F.map((v) => [v]), ...new Array(n).fill(0).map(() => [0])];
  const x = solve(big, rhs);
  if (!x) return null;
  return {
    amp: Array.from({ length: n }, (_, i) => Math.hypot(x[i][0], x[i + n][0])),
    phase: Array.from({ length: n }, (_, i) => (Math.atan2(-x[i + n][0], x[i][0]) * 180) / Math.PI),
  };
}

/**
 * A random physical system: M = A*A^T + diag (symmetric positive definite, and
 * deliberately NOT diagonal), K likewise. Both are then genuine structures
 * rather than the tidy chains the oracle suite uses.
 */
function randomSystem(rnd: () => number, n: number): { M: Matrix; K: Matrix } {
  const mk = (scale: number, floor: number): Matrix => {
    const A: Matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => rnd() * 2 - 1));
    const S: Matrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        let s = 0;
        for (let p = 0; p < n; p++) s += A[i][p] * A[j][p];
        return s * scale;
      }),
    );
    for (let i = 0; i < n; i++) S[i][i] += floor;
    return S;
  };
  return { M: mk(1, 1), K: mk(200, 100) };
}

// ---------------------------------------------------------------------------

describe("randomised systems agree with a direct complex solve", () => {
  const rnd = lcg(20260729);
  const alpha = 0.4,
    beta = 0.0015;
  let checked = 0;

  test("100 random systems at a spread of frequencies", () => {
    for (let trial = 0; trial < 100; trial++) {
      const n = 2 + (trial % 4); // 2..5 degrees of freedom
      const { M, K } = randomSystem(rnd, n);
      const F = Array.from({ length: n }, () => rnd() * 200 - 100);
      const C: Matrix = M.map((row, i) => row.map((v, j) => alpha * v + beta * K[i][j]));

      const modal = modalAnalysis(M, K);
      if (!modal.ok) throw new Error(`modal analysis failed on trial ${trial}: ${modal.error}`);
      const zetas = rayleighDamping(alpha, beta, modal.frequencies);

      for (const frac of [0, 0.3, 0.85, 1.0, 1.7, 3.1]) {
        const w = frac * modal.frequencies[Math.min(1, n - 1)];
        const oracle = directComplex(M, K, C, F, w);
        if (!oracle) continue;
        const r = modalForcedResponse(M, K, F, w, zetas);
        if (!r.ok) throw new Error(`trial ${trial} at w=${w} failed: ${r.error}`);
        for (let j = 0; j < n; j++) {
          near(r.amplitude[j], oracle.amp[j], 1e-5);
          // Phase is meaningless where the amplitude is numerically zero.
          if (oracle.amp[j] > 1e-8) {
            const d = Math.abs(((r.phaseDeg[j] - oracle.phase[j] + 540) % 360) - 180);
            expect(d).toBeLessThan(0.01);
          }
        }
        checked++;
      }
    }
    // Guard against the loop silently doing nothing — an empty property test
    // passes just as loudly as a real one.
    expect(checked).toBeGreaterThan(400);
  });
});

describe("degenerate and awkward systems", () => {
  test("REPEATED eigenvalues: two identical uncoupled oscillators", () => {
    // Mode shapes are not unique in the repeated subspace, so any basis the
    // solver picks must still give the same physical answer.
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [100, 0],
      [0, 100],
    ];
    const C: Matrix = [
      [0.4, 0],
      [0, 0.4],
    ];
    const F = [30, -12];
    for (const w of [0, 4, 9.9, 10, 15]) {
      const r = modalForcedResponse(M, K, F, w, [0.02, 0.02]);
      // zeta = c/(2*sqrt(km)) = 0.4/20 = 0.02, consistent with C above.
      const oracle = directComplex(M, K, C, F, w);
      if (!oracle) continue;
      if (!r.ok) throw new Error(r.error);
      for (let j = 0; j < 2; j++) near(r.amplitude[j], oracle.amp[j], 1e-6);
    }
  });

  test("a repeated frequency does not merge the two degrees of freedom", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [100, 0],
      [0, 100],
    ];
    // Force only DOF 1: DOF 2 is uncoupled and must not move at all.
    const r = modalForcedResponse(M, K, [50, 0], 5, 0.05);
    if (!r.ok) throw new Error(r.error);
    expect(r.amplitude[1]).toBeLessThan(1e-12);
    expect(r.amplitude[0]).toBeGreaterThan(0);
  });

  test("a NON-DIAGONAL (consistent) mass matrix is handled", () => {
    const M: Matrix = [
      [2, 0.5],
      [0.5, 3],
    ];
    const K: Matrix = [
      [400, -150],
      [-150, 300],
    ];
    const alpha = 0.5,
      beta = 0.001;
    const C: Matrix = M.map((row, i) => row.map((v, j) => alpha * v + beta * K[i][j]));
    const modal = modalAnalysis(M, K);
    if (!modal.ok) throw new Error(modal.error);
    const z = rayleighDamping(alpha, beta, modal.frequencies);
    for (const w of [1, 6, 11, 19]) {
      const oracle = directComplex(M, K, C, [20, -5], w);
      const r = modalForcedResponse(M, K, [20, -5], w, z);
      if (!r.ok || !oracle) throw new Error("failed");
      for (let j = 0; j < 2; j++) near(r.amplitude[j], oracle.amp[j], 1e-6);
    }
  });

  test("OVERDAMPED modes (zeta > 1) do not produce NaN", () => {
    const M: Matrix = [
      [1, 0],
      [0, 2],
    ];
    const K: Matrix = [
      [300, -100],
      [-100, 200],
    ];
    for (const z of [1, 1.5, 5, 50]) {
      const r = modalForcedResponse(M, K, [10, 10], 7, z);
      if (!r.ok) throw new Error(r.error);
      for (const a of r.amplitude) {
        expect(Number.isFinite(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(0);
      }
      for (const p of r.phaseDeg) expect(Number.isFinite(p)).toBe(true);
    }
  });

  test("at omega = 0 the answer is the STATIC one, K^-1 F, whatever the damping", () => {
    const M: Matrix = [
      [2, 0.5],
      [0.5, 3],
    ];
    const K: Matrix = [
      [400, -150],
      [-150, 300],
    ];
    const F = [20, -5];
    const stat = solve(K, F.map((v) => [v]));
    if (!stat) throw new Error("singular");
    for (const z of [0, 0.02, 0.5, 3]) {
      const r = modalForcedResponse(M, K, F, 0, z);
      if (!r.ok) throw new Error(r.error);
      for (let j = 0; j < 2; j++) near(r.amplitude[j], Math.abs(stat[j][0]), 1e-9);
    }
  });

  test("hugely separated stiffnesses stay finite", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1e-6],
    ];
    const K: Matrix = [
      [1e9, -1e3],
      [-1e3, 1e3],
    ];
    const r = modalForcedResponse(M, K, [1, 1], 100, 0.03);
    expect(r.ok).toBe(true);
    if (r.ok) for (const a of r.amplitude) expect(Number.isFinite(a)).toBe(true);
  });
});

describe("size and termination", () => {
  test("the largest allowed system returns quickly rather than freezing the pane", () => {
    const rnd = lcg(7);
    const n = 12; // MAX_DOF — the boundary is where a cubic solve actually bites.
    const { M, K } = randomSystem(rnd, n);
    const F = Array.from({ length: n }, (_, i) => (i % 3) - 1);
    const started = Date.now();
    const r = modalForcedResponse(M, K, F, 12, 0.03);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amplitude).toHaveLength(n);
      for (const a of r.amplitude) expect(Number.isFinite(a)).toBe(true);
      // Shares are a distribution over the modes.
      const total = r.contributions.reduce((s, c) => s + c.share, 0);
      near(total, 1, 1e-9);
    }
  });

  test("one degree of freedom beyond MAX_DOF it refuses instead of grinding", () => {
    const n = 13;
    const M: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    const K: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 100 : 0)));
    const r = modalForcedResponse(M, K, new Array(n).fill(1), 5, 0.02);
    expect(r.ok).toBe(false);
  });

  test("non-finite inputs are refused, not propagated as NaN", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    expect(modalForcedResponse(M, K, [NaN, 1], 5, 0.02).ok).toBe(false);
    expect(modalForcedResponse(M, K, [Infinity, 1], 5, 0.02).ok).toBe(false);
    expect(modalForcedResponse(M, K, [1, 1], NaN, 0.02).ok).toBe(false);
    expect(modalForcedResponse(M, K, [1, 1], 5, NaN).ok).toBe(false);
    expect(modalForcedResponse(M, K, [1, 1], 5, [0.02, NaN]).ok).toBe(false);
  });

  test("an unphysical mass matrix is still refused through this entry point", () => {
    const M: Matrix = [
      [1, 0],
      [0, -1],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modalForcedResponse(M, K, [1, 1], 5, 0.02);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/positive definite|inertia/i);
  });
});

describe("the modal breakdown does not mislead", () => {
  test("shares always sum to 1 and are never negative", () => {
    const rnd = lcg(99);
    for (let t = 0; t < 20; t++) {
      const n = 3;
      const { M, K } = randomSystem(rnd, n);
      const F = Array.from({ length: n }, () => rnd() * 10 - 5);
      const r = modalForcedResponse(M, K, F, 5 + t, 0.03);
      if (!r.ok) continue;
      let total = 0;
      for (const c of r.contributions) {
        expect(c.share).toBeGreaterThanOrEqual(0);
        total += c.share;
      }
      near(total, 1, 1e-9);
    }
  });

  test("the dominant mode really is the largest contributor", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const modal = modalAnalysis(M, K);
    if (!modal.ok) throw new Error(modal.error);
    // Drive right at mode 2 with a load that excites it.
    const r = modalForcedResponse(M, K, [10, -3], modal.frequencies[1], 0.01);
    if (!r.ok) throw new Error(r.error);
    const best = r.contributions.reduce((a, b) => (b.share > a.share ? b : a));
    expect(r.dominantMode).toBe(best.mode);
    expect(best.mode).toBe(2);
  });

  test("cancellation is warned about rather than hidden", () => {
    // Between the two resonances the modal contributions oppose, so the total is
    // less than the sum of the parts. The note must appear.
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modalForcedResponse(M, K, [10, 2], 14, 0.02);
    if (!r.ok) throw new Error(r.error);
    if (r.contributions[r.dominantMode - 1].share < 0.9)
      expect(r.notes.join(" ")).toMatch(/partially CANCEL/i);
  });
});
