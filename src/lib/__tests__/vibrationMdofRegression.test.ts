// Regressions found by an INDEPENDENT bug hunt on v2.36.0, not by the tests
// that shipped with it.
//
// The most useful thing about these four is why the original suite could not
// see them. `vibrationMdof.adversarial.test.ts` builds its 100 random systems
// with `mk(200, 100)`, which adds 100 to every diagonal of K — so every system
// it generates is positive definite and NOT ONE of them has a rigid-body mode.
// `rayleighDamping` was checked against a direct complex solve in that file, and
// the single case it gets wrong was excluded by the generator's construction. A
// property test is only as good as the property its generator can reach.
//
// So this file deliberately covers free-free structures, absurd-but-finite
// magnitudes, and scale sensitivity — the three things the original generator
// could not produce.

import { modalForcedResponse, rayleighDamping, modalAnalysis, chainSystem } from "../vibration";
import { solve, Matrix } from "../linalg";

const near = (a: number, b: number, tol = 1e-6) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1e-9, Math.abs(b)));

/** Direct complex solve of (K - w^2 M + j w C) x = F. Shares no code with modes. */
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

// ---------------------------------------------------------------------------
// 1. Rayleigh damping on a structure WITH a rigid-body mode
// ---------------------------------------------------------------------------

describe("Rayleigh damping is exact on a free-free structure", () => {
  const free = chainSystem([1, 1], [100], false);
  if ("ok" in free) throw new Error("chain failed");
  const { M, K } = free;
  const F = [10, 0];

  test.each([
    [0.6, 0.002],
    [5, 0],
    [0, 0.01],
    [1.5, 0.005],
  ])("alpha=%s beta=%s matches the direct complex solve at several frequencies", (alpha, beta) => {
    const C: Matrix = M.map((row, i) => row.map((v, j) => alpha * v + beta * K[i][j]));
    for (const w of [0.5, 2, 7, 14]) {
      const oracle = directComplex(M, K, C, F, w);
      if (!oracle) continue;
      const r = modalForcedResponse(M, K, F, w, { alpha, beta });
      if (!r.ok) throw new Error(`refused at w=${w}: ${r.error}`);
      for (let j = 0; j < 2; j++) {
        near(r.amplitude[j], oracle.amp[j], 1e-6);
        const d = Math.abs(((r.phaseDeg[j] - oracle.phase[j] + 540) % 360) - 180);
        expect(d).toBeLessThan(1e-4);
      }
    }
  });

  test("the RATIO route on the same structure is measurably wrong, and says so", () => {
    // This is the bug: a ratio cannot carry damping on a rigid-body mode.
    const alpha = 0.6,
      beta = 0.002;
    const C: Matrix = M.map((row, i) => row.map((v, j) => alpha * v + beta * K[i][j]));
    const modal = modalAnalysis(M, K);
    if (!modal.ok) throw new Error(modal.error);
    const ratios = rayleighDamping(alpha, beta, modal.frequencies);
    expect(ratios[0]).toBe(0); // the rigid-body mode's ratio is unrepresentable

    const viaRatios = modalForcedResponse(M, K, F, 0.5, ratios);
    const viaPair = modalForcedResponse(M, K, F, 0.5, { alpha, beta });
    const oracle = directComplex(M, K, C, F, 0.5);
    if (!viaRatios.ok || !viaPair.ok || !oracle) throw new Error("failed");

    // The pair is right...
    near(viaPair.amplitude[0], oracle.amp[0], 1e-6);
    // ...and the ratio route is off by more than 50%, which is the whole point.
    expect(Math.abs(viaRatios.amplitude[0] - oracle.amp[0]) / oracle.amp[0]).toBeGreaterThan(0.5);
    // So it must warn rather than pass silently.
    expect(viaRatios.notes.join(" ")).toMatch(/cannot describe damping on it|treated as UNDAMPED/i);
  });

  test("a grounded structure is unaffected by the change — no rigid-body mode, no warning", () => {
    const g = chainSystem([2, 1, 3], [400, 300, 500], true);
    if ("ok" in g) throw new Error("chain failed");
    const alpha = 0.6,
      beta = 0.002;
    const modal = modalAnalysis(g.M, g.K);
    if (!modal.ok) throw new Error(modal.error);
    const viaRatios = modalForcedResponse(g.M, g.K, [100, 0, -40], 9, rayleighDamping(alpha, beta, modal.frequencies));
    const viaPair = modalForcedResponse(g.M, g.K, [100, 0, -40], 9, { alpha, beta });
    if (!viaRatios.ok || !viaPair.ok) throw new Error("failed");
    for (let j = 0; j < 3; j++) near(viaRatios.amplitude[j], viaPair.amplitude[j], 1e-9);
    expect(viaPair.notes.join(" ")).not.toMatch(/treated as UNDAMPED/i);
  });

  test("Rayleigh alpha/beta are validated", () => {
    expect(modalForcedResponse(M, K, F, 5, { alpha: -1, beta: 0 }).ok).toBe(false);
    expect(modalForcedResponse(M, K, F, 5, { alpha: NaN, beta: 0 }).ok).toBe(false);
    expect(modalForcedResponse(M, K, F, 5, { alpha: 0, beta: Infinity }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Absurd-but-finite inputs must refuse, not return NaN as a success
// ---------------------------------------------------------------------------

describe("finite inputs whose combination overflows are refused", () => {
  const M: Matrix = [
    [1, 0],
    [0, 1],
  ];
  const K: Matrix = [
    [200, -100],
    [-100, 200],
  ];

  test.each([1e150, 1.4e154, 1e200, 1e300])("omega = %s does not return NaN as ok", (w) => {
    const r = modalForcedResponse(M, K, [10, 0], w, 0.02);
    if (r.ok) {
      for (const a of r.amplitude) expect(Number.isFinite(a)).toBe(true);
      for (const p of r.phaseDeg) expect(Number.isFinite(p)).toBe(true);
    } else {
      expect(r.error).toMatch(/overflow/i);
    }
  });

  test("an absurd damping ratio does not return NaN as ok", () => {
    const r = modalForcedResponse(M, K, [1e10, 0], 1, 1e300);
    if (r.ok) for (const a of r.amplitude) expect(Number.isFinite(a)).toBe(true);
    else expect(r.error).toMatch(/overflow/i);
  });

  test("ordinary frequencies are untouched by the new guard", () => {
    const r = modalForcedResponse(M, K, [10, 0], 12, 0.02);
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. "Is this mode excited?" must not depend on the units of the load
// ---------------------------------------------------------------------------

describe("the nodal-force test is relative, so scaling the load cannot flip it", () => {
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

  test("a load on DOF 1 at resonance is refused at EVERY scale, not just large ones", () => {
    // DOF 1 is not a node of mode 1, so this is a genuine unbounded resonance
    // however small the load. The old absolute 1e-12 called it a node below that.
    for (const f0 of [1e-13, 1e-12, 1e-11, 1, 1e6]) {
      const r = modalForcedResponse(M, K, [f0, 0], modal.frequencies[0], 0);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/without bound|no steady state/i);
    }
  });

  test("a genuinely nodal load is accepted at EVERY scale", () => {
    // Symmetric load, antisymmetric mode 2: never excited, whatever the size.
    for (const s of [1e-6, 1, 1e6, 1e9, 1e12]) {
      const r = modalForcedResponse(M, K, [s, s], modal.frequencies[1], 0);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.notes.join(" ")).toMatch(/NODE of that mode/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The self-equilibrating explanation
// ---------------------------------------------------------------------------

describe("a self-equilibrating load on a free-free structure is explained correctly", () => {
  test("it is not called a node, and not called fragile", () => {
    const free = chainSystem([1, 1], [100], false);
    if ("ok" in free) throw new Error("chain failed");
    const r = modalForcedResponse(free.M, free.K, [10, -10], 0, 0.02);
    if (!r.ok) throw new Error(r.error);
    const notes = r.notes.join(" ");
    expect(notes).toMatch(/self-equilibrating/i);
    expect(notes).not.toMatch(/will not survive a small change in where the load acts/i);
  });
});
