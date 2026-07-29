// Round-two regressions: bugs found in the FIXES from round one.
//
// Every one of these was in code written to repair an earlier bug, which is the
// point worth recording — a fix is exactly as likely to be wrong as the original,
// and none of the round-one repairs had been independently reviewed before this.
//
//   A. `isNodal` formed |phi| * |F| before dividing. Mode shapes are
//      mass-normalised, so |phi| ~ 1/sqrt(m): a light DOF under a large load
//      overflowed that product to Infinity, and `|f| < 1e-12 * Infinity` is true
//      of every finite f. A mode sitting exactly on an undamped resonance was
//      then reported as a NODE with amplitude 0 while its generalised force was
//      1e307.
//   B. The complex division squared both parts first, so a response with an
//      elementary answer (F = 1e300 at omega = 1e150 gives exactly 1) came back
//      NaN and was refused with "use units that keep the numbers in a physical
//      range" — advice that could not help, because the answer was representable.
//   C. `zeta` escaped the finiteness guard and reached the pane as "not finite".
//   D. Under Rayleigh damping a rigid-body mode reports zeta = 0, which reads as
//      undamped though its coefficient is alpha; and the "you supplied no
//      damping" note keyed on the ratio rather than the coefficient.
//   E. `den2 === 0` was a test on a SQUARED quantity, so zeta = 1e-200
//      underflowed to zero and a damped mode was refused as undamped.

import { modalForcedResponse, modalAnalysis, chainSystem } from "../vibration";
import { solve, Matrix } from "../linalg";

const near = (a: number, b: number, tol = 1e-6) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1e-12, Math.abs(b)));

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
  return Array.from({ length: n }, (_, i) => Math.hypot(x[i][0], x[i + n][0]));
}

// ---------------------------------------------------------------------------

describe("A: isNodal must not overflow its own scale", () => {
  const M: Matrix = [
    [1e-30, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const K: Matrix = [
    [4e-28, 0, 0],
    [0, 200, -100],
    [0, -100, 200],
  ];

  test("a genuinely excited undamped resonance is refused, not called a node", () => {
    const modal = modalAnalysis(M, K);
    if (!modal.ok) throw new Error(modal.error);
    const w = modal.frequencies.find((f) => Math.abs(f - 20) < 1e-6) ?? 20;
    const F = [1e292, 8.137e293, -5.812e293];
    const r = modalForcedResponse(M, K, F, w, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/without bound|no steady state/i);
  });

  test("no contribution ever claims a huge force and zero amplitude at once", () => {
    const r = modalForcedResponse(M, K, [1e292, 8.137e293, -5.812e293], 19, 0.01);
    if (r.ok) {
      for (const c of r.contributions) {
        const contradictory = Math.abs(c.force) > 1e100 && c.amplitude === 0;
        expect({ mode: c.mode, contradictory }).toEqual({ mode: c.mode, contradictory: false });
      }
    }
  });

  test("scale invariance still holds after the change", () => {
    const Ms: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const Ks: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const modal = modalAnalysis(Ms, Ks);
    if (!modal.ok) throw new Error(modal.error);
    for (const s of [1e-300, 1e-6, 1, 1e6, 1e300]) {
      // Symmetric load is nodal for the antisymmetric mode at every scale.
      const nodal = modalForcedResponse(Ms, Ks, [s, s], modal.frequencies[1], 0);
      expect({ s, ok: nodal.ok }).toEqual({ s, ok: true });
      // A load on DOF 1 is NOT nodal for mode 1 at any scale.
      const excited = modalForcedResponse(Ms, Ks, [s, 0], modal.frequencies[0], 0);
      expect({ s, ok: excited.ok }).toEqual({ s, ok: false });
    }
  });
});

describe("B: a representable response is computed, not refused", () => {
  const M: Matrix = [
    [1, 0],
    [0, 1],
  ];
  const K: Matrix = [
    [200, -100],
    [-100, 200],
  ];

  test("F = 1e300 at omega = 1e150 gives the elementary answer 1", () => {
    const r = modalForcedResponse(M, K, [1e300, 0], 1e150, 0.02);
    expect(r.ok).toBe(true);
    if (r.ok) {
      near(r.amplitude[0], 1, 1e-9);
      expect(Number.isFinite(r.amplitude[1])).toBe(true);
    }
  });

  test("a spread of extreme-but-representable combinations all resolve", () => {
    for (const [f, w] of [
      [1e200, 1e100],
      [1e250, 1e125],
      [1e300, 1e150],
      [1e150, 1e75],
    ] as [number, number][]) {
      const r = modalForcedResponse(M, K, [f, 0], w, 0.02);
      expect({ f, w, ok: r.ok }).toEqual({ f, w, ok: true });
      if (r.ok) near(r.amplitude[0], f / (w * w), 1e-6);
    }
  });

  test("a genuinely unrepresentable one is still refused", () => {
    const r = modalForcedResponse(M, K, [1e300, 0], 1e-200, 0.02);
    if (r.ok) for (const a of r.amplitude) expect(Number.isFinite(a)).toBe(true);
  });
});

describe("C: zeta cannot reach the caller non-finite", () => {
  test("an enormous alpha with a small natural frequency is refused", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [1e-8, 0],
      [0, 1],
    ];
    const r = modalForcedResponse(M, K, [1, 1], 0.5, { alpha: 1e308, beta: 0 });
    if (r.ok) {
      for (const z of r.zeta) expect(Number.isFinite(z)).toBe(true);
      for (const c of r.contributions) expect(Number.isFinite(c.zeta)).toBe(true);
    } else {
      expect(r.error).toMatch(/overflow/i);
    }
  });
});

describe("D: the Rayleigh rigid-body mode is explained, not silently zeroed", () => {
  const free = chainSystem([1, 1, 1], [100, 100], false);
  if ("ok" in free) throw new Error("chain failed");

  test("zeta reads 0 for the rigid-body mode, and a note says why", () => {
    const r = modalForcedResponse(free.M, free.K, [10, 0, -10], 1, { alpha: 0.6, beta: 0.002 });
    if (!r.ok) throw new Error(r.error);
    expect(r.frequencies[0]).toBe(0);
    expect(r.zeta[0]).toBe(0);
    expect(r.notes.join(" ")).toMatch(/limitation of the RATIO|coefficient is alpha/i);
  });

  test("and the answer really did use alpha, whatever zeta reports", () => {
    const alpha = 0.6,
      beta = 0.002;
    const C: Matrix = free.M.map((row, i) => row.map((v, j) => alpha * v + beta * free.K[i][j]));
    const F = [10, 0, -4];
    for (const w of [0.05, 0.3, 1, 5]) {
      const oracle = directComplex(free.M, free.K, C, F, w);
      const r = modalForcedResponse(free.M, free.K, F, w, { alpha, beta });
      if (!r.ok || !oracle) throw new Error("failed");
      for (let j = 0; j < 3; j++) near(r.amplitude[j], oracle[j], 1e-6);
    }
  });

  test("supplying damping is never described as supplying none", () => {
    // All modes rigid: K = 0. Rayleigh alpha still damps them.
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [0, 0],
      [0, 0],
    ];
    const r = modalForcedResponse(M, K, [1, 0], 2, { alpha: 0.6, beta: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).not.toMatch(/damping you did not supply/i);
    const C: Matrix = [
      [0.6, 0],
      [0, 0.6],
    ];
    const oracle = directComplex(M, K, C, [1, 0], 2);
    if (oracle) near(r.amplitude[0], oracle[0], 1e-6);
  });

  test("genuinely undamped input still gets the zero-damping note", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modalForcedResponse(M, K, [1, 0], 5, 0);
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/undamped forced response/i);
  });
});

describe("E: a tiny but real damping is not rounded away into a refusal", () => {
  test("zeta = 1e-200 at resonance is solved, not refused as undamped", () => {
    const g = chainSystem([1, 1], [100, 100], true);
    if ("ok" in g) throw new Error("chain failed");
    const modal = modalAnalysis(g.M, g.K);
    if (!modal.ok) throw new Error(modal.error);
    const r = modalForcedResponse(g.M, g.K, [10, 0], modal.frequencies[0], [1e-200, 0.02]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Number.isFinite(r.amplitude[0])).toBe(true);
      expect(r.amplitude[0]).toBeGreaterThan(1e100);
    }
  });

  test("exactly zero damping at resonance is still refused", () => {
    const g = chainSystem([1, 1], [100, 100], true);
    if ("ok" in g) throw new Error("chain failed");
    const modal = modalAnalysis(g.M, g.K);
    if (!modal.ok) throw new Error(modal.error);
    const r = modalForcedResponse(g.M, g.K, [10, 0], modal.frequencies[0], 0);
    expect(r.ok).toBe(false);
  });
});
