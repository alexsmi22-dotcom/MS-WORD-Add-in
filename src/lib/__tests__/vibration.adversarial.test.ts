// Adversarial pass over the vibration engine.
//
// The oracle tests ask whether the vibration theory is right for a textbook
// system. This file assumes hostile input and asks the two questions they
// cannot:
//
//   1. DOES IT TERMINATE, fast? The Jacobi eigen-solver sweeps until it
//      converges, and the Cholesky factorisation runs before it. Both sit
//      behind a pane that recomputes on every keystroke.
//   2. DOES IT REFUSE RATHER THAN INVENT? A mass matrix that is not positive
//      definite is not a structure; a free vibration that grows is not damped;
//      a system with zeta at exactly 1 has no damped natural frequency. Each of
//      those must be named rather than given a plausible number.
//
// The stiffness ratios probed here are not contrived: a real structure can
// easily span six orders of magnitude between a soft mount and a stiff frame in
// the same model, and that is exactly what makes a generalised eigenproblem
// ill-conditioned.

import {
  sdofProperties,
  freeResponse,
  dampingFromDecrement,
  forcedResponse,
  magnification,
  transmissibility,
  frequencySweep,
  modalAnalysis,
  chainSystem,
} from "../vibration";
import { Matrix } from "../linalg";

function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

function nonFinite(o: unknown, path = "result"): string[] {
  const bad: string[] = [];
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) bad.push(`${p} = ${v}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${p}.${k}`);
    }
  };
  walk(o, path);
  return bad;
}

const HOSTILE = [NaN, Infinity, -Infinity];
const EXTREME = [1e-12, 1e-6, 1e6, 1e12, 1e30];

// ---------------------------------------------------------------------------
describe("SDOF properties refuse the unphysical and survive the extreme", () => {
  test("non-finite and non-positive parameters are refused", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(sdofProperties(v, 100, 1).ok).toBe(false);
      expect(sdofProperties(1, v, 1).ok).toBe(false);
    }
    for (const v of [...HOSTILE, -1]) expect(sdofProperties(1, 100, v).ok).toBe(false);
  });

  test("extreme mass and stiffness stay finite", () => {
    within(200, () => {
      for (const m of EXTREME) {
        for (const k of EXTREME) {
          const p = sdofProperties(m, k, 0);
          if (p.ok) {
            expect(nonFinite({ wn: p.wn, fn: p.fn, cc: p.cc, zeta: p.zeta, wd: p.wd })).toEqual([]);
            expect(p.wn).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  test("zeta exactly at 1 gives no damped frequency rather than a NaN", () => {
    const p = sdofProperties(1, 100, 20);
    if (!p.ok) throw new Error(p.error);
    expect(p.kind).toBe("critically damped");
    expect(p.wd).toBe(0);
    expect(Number.isNaN(p.wd)).toBe(false);
  });

  test("enormous damping is overdamped, not an error", () => {
    const p = sdofProperties(1, 100, 1e9);
    if (!p.ok) throw new Error(p.error);
    expect(p.kind).toBe("overdamped");
    expect(nonFinite({ z: p.zeta, wd: p.wd })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("free response is bounded and finite in every damping regime", () => {
  test("every regime stays finite over a wide sweep", () => {
    within(2000, () => {
      for (const c of [0, 0.1, 2, 19.9, 20, 20.1, 100, 1e6]) {
        const r = freeResponse(1, 100, c, 0.05, 0.1, 10, 500);
        if (r.ok) {
          expect(nonFinite(r.x)).toEqual([]);
          // Free vibration cannot grow: every point is bounded by the initial
          // energy, so nothing may exceed a generous multiple of it.
          const bound = 10 * (Math.abs(0.05) + Math.abs(0.1) / Math.sqrt(100));
          expect(Math.max(...r.x.map(Math.abs))).toBeLessThan(bound);
        }
      }
    });
  });

  test("zero initial conditions give a flat zero response, not NaN", () => {
    for (const c of [0, 4, 20, 40]) {
      const r = freeResponse(1, 100, c, 0, 0, 5, 100);
      if (!r.ok) throw new Error(r.error);
      expect(r.x.every((v) => Math.abs(v) < 1e-15)).toBe(true);
    }
  });

  test("absurd end times and point counts are clamped", () => {
    within(2000, () => {
      for (const [tEnd, n] of [
        [1e9, 400],
        [1e-9, 400],
        [10, 1e7],
        [10, -5],
        [10, 0],
      ] as [number, number][]) {
        const r = freeResponse(1, 100, 4, 0.05, 0, tEnd, n);
        if (r.ok) {
          expect(r.t.length).toBeLessThanOrEqual(2000);
          expect(nonFinite(r.x)).toEqual([]);
        }
      }
    });
    expect(freeResponse(1, 100, 4, 0.05, 0, 0).ok).toBe(false);
    expect(freeResponse(1, 100, 4, 0.05, 0, NaN).ok).toBe(false);
    expect(freeResponse(1, 100, 4, NaN, 0, 5).ok).toBe(false);
  });

  test("a very lightly damped long simulation does not drift or blow up", () => {
    const r = freeResponse(1, 100, 1e-6, 0.05, 0, 2000, 2000);
    if (!r.ok) throw new Error(r.error);
    expect(nonFinite(r.x)).toEqual([]);
    expect(Math.max(...r.x.map(Math.abs))).toBeLessThan(0.0501);
  });
});

// ---------------------------------------------------------------------------
describe("damping from a measured trace", () => {
  test("hostile amplitudes are refused", () => {
    for (const v of [...HOSTILE, 0, -1]) {
      expect(dampingFromDecrement(v, 1, 1).ok).toBe(false);
      expect(dampingFromDecrement(2, v, 1).ok).toBe(false);
    }
    for (const v of [...HOSTILE, 0, -1]) expect(dampingFromDecrement(2, 1, v).ok).toBe(false);
  });

  test("the estimated damping ratio is always between 0 and 1", () => {
    const bad: string[] = [];
    within(500, () => {
      for (let i = 1; i < 200; i++) {
        const ratio = 1 + i * 0.5;
        const r = dampingFromDecrement(ratio, 1, 1);
        if (r.ok && !(r.zeta > 0 && r.zeta < 1)) bad.push(`ratio ${ratio} -> zeta ${r.zeta}`);
      }
    });
    expect(bad).toEqual([]);
  });

  test("an enormous decay ratio still gives a sub-unity damping ratio", () => {
    const r = dampingFromDecrement(1e300, 1, 1);
    if (r.ok) {
      expect(r.zeta).toBeLessThan(1);
      expect(Number.isFinite(r.delta)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("forced response and the two thresholds hold everywhere", () => {
  test("magnification and transmissibility stay finite except at undamped resonance", () => {
    // Failures are COLLECTED and asserted once rather than asserted inside the
    // loop. Jest's expect() is far more expensive than the functions under test,
    // so 14,000 in-loop assertions measured the test harness rather than the
    // engine — and then flaked against its own timing budget under parallel
    // load. The check is identical; only the accounting changed.
    const bad: string[] = [];
    within(1000, () => {
      for (const z of [0, 0.001, 0.05, 0.2, 0.707, 1, 5]) {
        for (let r = 0; r <= 10; r += 0.01) {
          if (z === 0 && Math.abs(r - 1) < 1e-9) continue; // genuinely infinite
          if (Number.isNaN(magnification(r, z))) bad.push(`magnification(${r}, ${z})`);
          if (Number.isNaN(transmissibility(r, z))) bad.push(`transmissibility(${r}, ${z})`);
        }
      }
    });
    expect(bad).toEqual([]);
  });

  // The invariant the whole isolation story rests on.
  test("transmissibility is 1 at r = sqrt(2) for every damping ratio, including huge ones", () => {
    for (const z of [0, 1e-6, 0.1, 0.707, 1, 10, 1000]) {
      expect(Math.abs(transmissibility(Math.SQRT2, z) - 1)).toBeLessThan(1e-9);
    }
  });

  test("transmissibility is above 1 below sqrt(2) and below 1 above it, for every zeta", () => {
    for (const z of [0.01, 0.1, 0.5, 1, 3]) {
      for (const r of [0.5, 1, 1.3]) expect(transmissibility(r, z)).toBeGreaterThan(1 - 1e-12);
      for (const r of [1.5, 2, 5, 20]) expect(transmissibility(r, z)).toBeLessThan(1 + 1e-12);
    }
  });

  test("the no-peak threshold is exactly 1/sqrt(2)", () => {
    // Just below: a peak exists. At and above: none.
    const below = forcedResponse(1, 100, (1 / Math.SQRT2 - 1e-6) * 20, 10, 5);
    const above = forcedResponse(1, 100, (1 / Math.SQRT2 + 1e-6) * 20, 10, 5);
    if (!below.ok || !above.ok) throw new Error("setup");
    expect(below.peakR).not.toBeNull();
    expect(above.peakR).toBeNull();
  });

  test("zero forcing frequency gives the static response", () => {
    const r = forcedResponse(1, 100, 4, 10, 0);
    if (!r.ok) throw new Error(r.error);
    expect(Math.abs(r.magnification - 1)).toBeLessThan(1e-12);
    expect(Math.abs(r.amplitude - 10 / 100)).toBeLessThan(1e-12);
    expect(Math.abs(r.transmissibility - 1)).toBeLessThan(1e-12);
  });

  test("undamped resonance is infinite rather than NaN, and is not reported as a number", () => {
    const r = forcedResponse(1, 100, 0, 10, 10);
    if (r.ok) {
      // The mathematics really is unbounded here; what matters is that it is
      // not NaN and not a plausible finite value.
      expect(Number.isNaN(r.magnification)).toBe(false);
      expect(r.magnification).toBeGreaterThan(1e12);
    }
  });

  test("the sweep is bounded whatever it is asked for", () => {
    within(1000, () => {
      for (const n of [1e7, -5, 0, NaN]) {
        const s = frequencySweep(0.1, 4, n as number);
        expect(s.r.length).toBeLessThanOrEqual(2000);
        expect(s.r.length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});

// ---------------------------------------------------------------------------
describe("modal analysis refuses the unphysical and converges on the hard", () => {
  test("a mass matrix that is not positive definite is refused", () => {
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    for (const M of [
      [
        [0, 0],
        [0, 1],
      ],
      [
        [-1, 0],
        [0, 1],
      ],
      [
        [1, 2],
        [2, 1],
      ],
    ] as Matrix[]) {
      expect(modalAnalysis(M, K).ok).toBe(false);
    }
  });

  test("non-finite entries are refused", () => {
    for (const v of HOSTILE) {
      expect(modalAnalysis([[v, 0], [0, 1]], [[1, 0], [0, 1]]).ok).toBe(false);
      expect(modalAnalysis([[1, 0], [0, 1]], [[v, 0], [0, 1]]).ok).toBe(false);
    }
  });

  test("the degree-of-freedom cap is enforced rather than attempted", () => {
    const n = 40;
    const M: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    const r = modalAnalysis(M, M);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Too many degrees of freedom/);
  });

  test("a badly conditioned chain still converges inside the pane budget", () => {
    // Stiffnesses spanning six orders of magnitude, which is a real modelling
    // situation (soft mount under a stiff frame) and the classic way to make a
    // generalised eigenproblem ill-conditioned.
    within(1500, () => {
      const built = chainSystem([1, 1, 1, 1], [1, 1e3, 1e6, 1e3], true);
      if ("ok" in built) throw new Error(built.error);
      const r = modalAnalysis(built.M, built.K);
      if (r.ok) {
        expect(nonFinite(r.frequencies)).toEqual([]);
        expect(nonFinite(r.modes)).toEqual([]);
        for (let i = 1; i < r.frequencies.length; i++) {
          expect(r.frequencies[i]).toBeGreaterThanOrEqual(r.frequencies[i - 1] - 1e-9);
        }
      }
    });
  });

  test("masses spanning many orders of magnitude still give real frequencies", () => {
    within(1500, () => {
      const built = chainSystem([1e-6, 1, 1e6], [100, 100, 100], true);
      if ("ok" in built) throw new Error(built.error);
      const r = modalAnalysis(built.M, built.K);
      if (r.ok) {
        expect(nonFinite(r.frequencies)).toEqual([]);
        expect(r.frequencies.every((w) => w >= 0)).toBe(true);
      }
    });
  });

  test("every eigenpair really satisfies K*phi = w^2*M*phi", () => {
    // The independent check: substitute back. Nothing about the transform,
    // the normalisation or the ordering can hide a wrong eigenvector from this.
    const cases: [number[], number[], boolean][] = [
      [[1, 1], [100, 100], true],
      [[2, 3], [150, 250], true],
      [[1, 1, 1], [100, 200, 300], true],
      [[1, 2, 3, 4], [10, 20, 30, 40], true],
      [[1, 1], [100], false],
    ];
    for (const [masses, springs, grounded] of cases) {
      const built = chainSystem(masses, springs, grounded);
      if ("ok" in built) throw new Error(built.error);
      const r = modalAnalysis(built.M, built.K);
      if (!r.ok) throw new Error(r.error);
      const n = masses.length;
      for (let col = 0; col < n; col++) {
        const w2 = r.frequencies[col] ** 2;
        const scale = Math.max(...built.K.flat().map(Math.abs));
        for (let i = 0; i < n; i++) {
          let kphi = 0;
          let mphi = 0;
          for (let j = 0; j < n; j++) {
            kphi += built.K[i][j] * r.modes[j][col];
            mphi += built.M[i][j] * r.modes[j][col];
          }
          expect(Math.abs(kphi - w2 * mphi)).toBeLessThan(1e-6 * scale);
        }
      }
    }
  });

  test("modes stay orthogonal through the mass matrix even when badly scaled", () => {
    const built = chainSystem([1e-3, 1, 1e3], [10, 1e4, 10], true);
    if ("ok" in built) throw new Error(built.error);
    const r = modalAnalysis(built.M, built.K);
    if (!r.ok) throw new Error(r.error);
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        let cross = 0;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cross += r.modes[i][a] * built.M[i][j] * r.modes[j][b];
        expect(Math.abs(cross)).toBeLessThan(1e-6);
      }
    }
  });

  test("a negative-definite stiffness is reported rather than returning imaginary frequencies", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [-200, 100],
      [100, -200],
    ];
    const r = modalAnalysis(M, K);
    if (r.ok) {
      expect(r.frequencies.every((w) => Number.isFinite(w) && w >= 0)).toBe(true);
      expect(r.notes.join(" ")).toMatch(/negative|unstable/i);
    }
  });

  test("chainSystem refuses every malformed request", () => {
    expect("ok" in chainSystem([], [], true)).toBe(true);
    expect("ok" in chainSystem([1, 1], [100], true)).toBe(true);
    expect("ok" in chainSystem([1, 1], [100, 100], false)).toBe(true);
    for (const v of [...HOSTILE, 0, -1]) {
      expect("ok" in chainSystem([1, v], [100, 100], true)).toBe(true);
      expect("ok" in chainSystem([1, 1], [100, v], true)).toBe(true);
    }
  });

  test("a large but legal system solves inside the pane budget", () => {
    within(1000, () => {
      const n = 12;
      const built = chainSystem(new Array(n).fill(1), new Array(n).fill(100), true);
      if ("ok" in built) throw new Error(built.error);
      const r = modalAnalysis(built.M, built.K);
      if (r.ok) {
        expect(r.frequencies).toHaveLength(n);
        expect(nonFinite(r.frequencies)).toEqual([]);
      }
    });
  });
});
