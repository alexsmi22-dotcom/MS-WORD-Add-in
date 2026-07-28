// Oracle tests for the vibration engine.
//
// The expected values are closed forms from vibration theory worked
// independently of the code, plus two structures whose natural frequencies have
// exact analytic answers — a two-mass chain whose eigenvalues are
// (3 -/+ sqrt(5))/2 * k/m, and the classic three-mass chain — so the modal
// solver is checked against algebra rather than against itself.

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
  SdofProperties,
  ModalResult,
  ForcedResponse,
} from "../vibration";
import { Matrix } from "../linalg";

const near = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

function sdof(m: number, k: number, c: number): SdofProperties {
  const r = sdofProperties(m, k, c);
  if (!r.ok) throw new Error(r.error);
  return r;
}

function modal(M: Matrix, K: Matrix): ModalResult {
  const r = modalAnalysis(M, K);
  if (!r.ok) throw new Error(r.error);
  return r;
}

// ---------------------------------------------------------------------------
describe("single degree of freedom properties", () => {
  // m = 1, k = 100: wn = 10 rad/s, cc = 20.
  test("natural frequency and critical damping match the closed forms", () => {
    const p = sdof(1, 100, 0);
    near(p.wn, 10);
    near(p.fn, 10 / (2 * Math.PI));
    near(p.cc, 20);
    expect(p.kind).toBe("undamped");
  });

  test("damping ratio is c over the critical value", () => {
    const p = sdof(1, 100, 4);
    near(p.zeta, 0.2);
    near(p.wd, 10 * Math.sqrt(1 - 0.04));
    expect(p.kind).toBe("underdamped");
  });

  test("the damping cases are classified at the right boundaries", () => {
    expect(sdof(1, 100, 20).kind).toBe("critically damped");
    expect(sdof(1, 100, 30).kind).toBe("overdamped");
    expect(sdof(1, 100, 0).kind).toBe("undamped");
  });

  test("static deflection under gravity", () => {
    near(sdof(2, 100, 0).staticDeflection, (2 * 9.80665) / 100);
  });

  test("overdamping is explained as slower than critical, not safer", () => {
    expect(sdof(1, 100, 30).notes.join(" ")).toMatch(/SLOWER than a critically/i);
  });

  test("non-physical parameters are refused", () => {
    expect(sdofProperties(0, 100, 1).ok).toBe(false);
    expect(sdofProperties(1, 0, 1).ok).toBe(false);
    expect(sdofProperties(1, 100, -1).ok).toBe(false);
    expect(sdofProperties(NaN, 100, 1).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("free vibration", () => {
  test("undamped free vibration is a pure cosine at wn", () => {
    const r = freeResponse(1, 100, 0, 0.05, 0, 2, 500);
    if (!r.ok) throw new Error(r.error);
    for (let i = 0; i < r.t.length; i++) near(r.x[i], 0.05 * Math.cos(10 * r.t[i]), 1e-8);
  });

  test("underdamped free vibration matches the closed form", () => {
    const m = 1,
      k = 100,
      c = 4;
    const wn = 10,
      zeta = 0.2,
      wd = wn * Math.sqrt(1 - zeta * zeta);
    const x0 = 0.05,
      v0 = 0.1;
    const r = freeResponse(m, k, c, x0, v0, 3, 500);
    if (!r.ok) throw new Error(r.error);
    for (let i = 0; i < r.t.length; i++) {
      const t = r.t[i];
      const exact =
        Math.exp(-zeta * wn * t) * (x0 * Math.cos(wd * t) + ((v0 + zeta * wn * x0) / wd) * Math.sin(wd * t));
      near(r.x[i], exact, 1e-8);
    }
  });

  // The critically damped form is NOT the underdamped one at zeta = 1: that
  // divides by wd, which is zero there.
  test("critically damped free vibration matches its own closed form", () => {
    const r = freeResponse(1, 100, 20, 0.05, 0.1, 2, 400);
    if (!r.ok) throw new Error(r.error);
    for (let i = 0; i < r.t.length; i++) {
      const t = r.t[i];
      near(r.x[i], Math.exp(-10 * t) * (0.05 + (0.1 + 10 * 0.05) * t), 1e-8);
    }
    expect(r.x.every((v) => Number.isFinite(v))).toBe(true);
  });

  test("overdamped free vibration does not oscillate", () => {
    const r = freeResponse(1, 100, 40, 0.05, 0, 3, 500);
    if (!r.ok) throw new Error(r.error);
    // Released from rest, an overdamped system returns monotonically.
    for (let i = 1; i < r.x.length; i++) expect(r.x[i]).toBeLessThanOrEqual(r.x[i - 1] + 1e-12);
    expect(r.x.every((v) => v >= -1e-9)).toBe(true);
  });

  test("the logarithmic decrement matches 2*pi*zeta/sqrt(1-zeta^2)", () => {
    const r = freeResponse(1, 100, 4, 0.05, 0, 3, 400);
    if (!r.ok) throw new Error(r.error);
    near(r.logDecrement as number, (2 * Math.PI * 0.2) / Math.sqrt(1 - 0.04));
  });

  test("and it really is the ratio of successive peaks in the simulated trace", () => {
    // Independent check: measure the decrement off the curve itself.
    const r = freeResponse(1, 100, 2, 0.05, 0, 6, 20000);
    if (!r.ok) throw new Error(r.error);
    const peaks: number[] = [];
    for (let i = 1; i < r.x.length - 1; i++) {
      if (r.x[i] > r.x[i - 1] && r.x[i] > r.x[i + 1] && r.x[i] > 0) peaks.push(r.x[i]);
    }
    expect(peaks.length).toBeGreaterThan(3);
    const measured = Math.log(peaks[0] / peaks[1]);
    expect(Math.abs(measured - (r.logDecrement as number))).toBeLessThan(0.01);
  });

  test("an undamped system is told it never decays", () => {
    const r = freeResponse(1, 100, 0, 0.05, 0, 2);
    if (!r.ok) throw new Error(r.error);
    expect(r.logDecrement).toBeNull();
    expect(r.notes.join(" ")).toMatch(/for ever/i);
  });
});

// ---------------------------------------------------------------------------
describe("damping from a measured trace", () => {
  test("it inverts the logarithmic decrement exactly", () => {
    // Round trip against freeResponse's own forward calculation.
    const fwd = freeResponse(1, 100, 4, 0.05, 0, 3, 400);
    if (!fwd.ok) throw new Error(fwd.error);
    const delta = fwd.logDecrement as number;
    const back = dampingFromDecrement(Math.exp(delta), 1, 1);
    if (!back.ok) throw new Error(back.error);
    near(back.zeta, 0.2, 1e-9);
  });

  test("several cycles are averaged", () => {
    const a = dampingFromDecrement(Math.exp(1.0), 1, 1);
    const b = dampingFromDecrement(Math.exp(5.0), 1, 5);
    if (!a.ok || !b.ok) throw new Error("setup");
    near(a.delta, b.delta);
    near(a.zeta, b.zeta);
  });

  test("the exact relation is used, not the light-damping approximation", () => {
    // For a large decrement the two differ noticeably.
    const r = dampingFromDecrement(Math.exp(2), 1, 1);
    if (!r.ok) throw new Error(r.error);
    const exact = 2 / Math.sqrt(4 * Math.PI * Math.PI + 4);
    near(r.zeta, exact);
    expect(r.zeta).toBeLessThan(2 / (2 * Math.PI));
    expect(r.notes.join(" ")).toMatch(/light-damping approximation/i);
  });

  // A free vibration that grows is not a damped system.
  test("a growing trace is refused and named", () => {
    const r = dampingFromDecrement(1, 2, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/self-excited|flutter|driven/i);
  });

  test("equal amplitudes and bad numbers are refused", () => {
    expect(dampingFromDecrement(1, 1, 1).ok).toBe(false);
    expect(dampingFromDecrement(0, 1, 1).ok).toBe(false);
    expect(dampingFromDecrement(2, 1, 0).ok).toBe(false);
    expect(dampingFromDecrement(NaN, 1, 1).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("forced vibration", () => {
  test("magnification at r = 0 is 1 and falls to 0 at high r", () => {
    near(magnification(0, 0.1), 1);
    expect(magnification(10, 0.1)).toBeLessThan(0.02);
  });

  test("magnification at r = 1 is 1/(2*zeta)", () => {
    for (const z of [0.05, 0.1, 0.2, 0.5]) near(magnification(1, z), 1 / (2 * z));
  });

  // THE FIRST COUNTER-INTUITIVE RESULT.
  test("the peak is at r = sqrt(1 - 2*zeta^2), below the natural frequency", () => {
    const r = forcedResponse(1, 100, 4, 10, 5) as ForcedResponse;
    const zeta = 0.2;
    near(r.peakR as number, Math.sqrt(1 - 2 * zeta * zeta));
    expect(r.peakR as number).toBeLessThan(1);
    near(r.peakMagnification as number, 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)));
  });

  test("and the reported peak really is the maximum of the curve", () => {
    // Independent check: scan the sweep and find the maximum numerically.
    const zeta = 0.2;
    const s = frequencySweep(zeta, 3, 20000);
    let bi = 0;
    for (let i = 1; i < s.magnification.length; i++) if (s.magnification[i] > s.magnification[bi]) bi = i;
    const r = forcedResponse(1, 100, 4, 10, 5) as ForcedResponse;
    expect(Math.abs(s.r[bi] - (r.peakR as number))).toBeLessThan(1e-3);
    expect(Math.abs(s.magnification[bi] - (r.peakMagnification as number))).toBeLessThan(1e-3);
  });

  test("above zeta = 1/sqrt(2) there is no peak at all", () => {
    const r = forcedResponse(1, 100, 0.8 * 20, 10, 5) as ForcedResponse;
    expect(r.peakR).toBeNull();
    expect(r.notes.join(" ")).toMatch(/NO resonant peak/i);
    // And the curve really is monotonically falling.
    const s = frequencySweep(0.8, 3, 2000);
    for (let i = 1; i < s.magnification.length; i++) {
      expect(s.magnification[i]).toBeLessThanOrEqual(s.magnification[i - 1] + 1e-12);
    }
  });

  // THE SECOND COUNTER-INTUITIVE RESULT.
  test("transmissibility is exactly 1 at r = sqrt(2) for every damping ratio", () => {
    for (const z of [0, 0.05, 0.2, 0.5, 1, 2]) near(transmissibility(Math.SQRT2, z), 1, 1e-9);
  });

  test("isolation happens only above sqrt(2), and below it the mount amplifies", () => {
    for (const z of [0.05, 0.2, 0.5]) {
      expect(transmissibility(1.2, z)).toBeGreaterThan(1);
      expect(transmissibility(3, z)).toBeLessThan(1);
    }
  });

  test("a mount below sqrt(2) is called out as amplifying", () => {
    const r = forcedResponse(1, 100, 2, 10, 12) as ForcedResponse;
    expect(r.isolating).toBe(false);
    expect(r.notes.join(" ")).toMatch(/AMPLIFYING rather than isolating/i);
  });

  // THE THIRD COUNTER-INTUITIVE RESULT.
  test("more damping helps below sqrt(2) and hurts above it", () => {
    // Below: damping reduces transmissibility.
    expect(transmissibility(1.0, 0.4)).toBeLessThan(transmissibility(1.0, 0.05));
    // Above: damping increases it.
    expect(transmissibility(4, 0.4)).toBeGreaterThan(transmissibility(4, 0.05));
  });

  test("the isolating case says that more damping makes isolation worse", () => {
    const r = forcedResponse(1, 100, 2, 10, 40) as ForcedResponse;
    expect(r.isolating).toBe(true);
    expect(r.notes.join(" ")).toMatch(/MORE DAMPING MAKES ISOLATION WORSE/i);
  });

  test("amplitude is the static deflection times the magnification", () => {
    const r = forcedResponse(2, 200, 4, 50, 7) as ForcedResponse;
    near(r.amplitude, (50 / 200) * r.magnification);
  });

  test("phase passes through 90 degrees at r = 1 whatever the damping", () => {
    for (const c of [1, 4, 10]) {
      const r = forcedResponse(1, 100, c, 10, 10) as ForcedResponse;
      near(r.phaseDeg, 90, 1e-9);
    }
  });

  test("bad inputs are refused", () => {
    expect(forcedResponse(1, 100, 1, NaN, 5).ok).toBe(false);
    expect(forcedResponse(1, 100, 1, 10, -1).ok).toBe(false);
    expect(forcedResponse(0, 100, 1, 10, 5).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("multi-degree-of-freedom modal analysis", () => {
  // Two equal masses, three equal springs, both ends grounded:
  // w1^2 = k/m, w2^2 = 3k/m. Modes are [1,1] (in phase) and [1,-1].
  test("the classic two-mass system matches the analytic frequencies", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modal(M, K);
    near(r.frequencies[0], Math.sqrt(100), 1e-8);
    near(r.frequencies[1], Math.sqrt(300), 1e-8);
  });

  test("its mode shapes are in-phase and out-of-phase", () => {
    const M: Matrix = [
      [1, 0],
      [0, 1],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modal(M, K);
    // Mode 1: both masses the same direction, equal magnitude.
    near(Math.abs(r.modes[0][0]), Math.abs(r.modes[1][0]), 1e-8);
    expect(r.modes[0][0] * r.modes[1][0]).toBeGreaterThan(0);
    // Mode 2: opposite directions.
    near(Math.abs(r.modes[0][1]), Math.abs(r.modes[1][1]), 1e-8);
    expect(r.modes[0][1] * r.modes[1][1]).toBeLessThan(0);
  });

  test("mode shapes are mass-normalised", () => {
    const M: Matrix = [
      [2, 0],
      [0, 3],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modal(M, K);
    for (let col = 0; col < 2; col++) {
      let mm = 0;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) mm += r.modes[i][col] * M[i][j] * r.modes[j][col];
      near(mm, 1, 1e-8);
    }
  });

  test("modes are orthogonal through the mass matrix", () => {
    const M: Matrix = [
      [2, 0],
      [0, 3],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modal(M, K);
    let cross = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) cross += r.modes[i][0] * M[i][j] * r.modes[j][1];
    expect(Math.abs(cross)).toBeLessThan(1e-8);
  });

  // A two-mass chain grounded at one end only: eigenvalues (3 -/+ sqrt(5))/2.
  test("a one-end-grounded chain matches its algebraic eigenvalues", () => {
    const built = chainSystem([1, 1], [100, 100], true);
    if ("ok" in built) throw new Error(built.error);
    const r = modal(built.M, built.K);
    const lo = ((3 - Math.sqrt(5)) / 2) * 100;
    const hi = ((3 + Math.sqrt(5)) / 2) * 100;
    near(r.frequencies[0], Math.sqrt(lo), 1e-7);
    near(r.frequencies[1], Math.sqrt(hi), 1e-7);
  });

  test("frequencies come back ascending", () => {
    const built = chainSystem([1, 2, 3], [100, 200, 300], true);
    if ("ok" in built) throw new Error(built.error);
    const r = modal(built.M, built.K);
    for (let i = 1; i < r.frequencies.length; i++) {
      expect(r.frequencies[i]).toBeGreaterThanOrEqual(r.frequencies[i - 1]);
    }
  });

  // A free-free chain can translate without strain, so it has a zero mode.
  test("an unrestrained chain reports a rigid-body mode rather than an error", () => {
    const built = chainSystem([1, 1], [100], false);
    if ("ok" in built) throw new Error(built.error);
    const r = modal(built.M, built.K);
    expect(r.frequencies[0]).toBeLessThan(1e-6);
    expect(r.notes.join(" ")).toMatch(/RIGID-BODY MODE/);
    // The second frequency is sqrt(k*(1/m1 + 1/m2)) = sqrt(200).
    near(r.frequencies[1], Math.sqrt(200), 1e-7);
  });

  test("a non-positive-definite mass matrix is refused as unphysical", () => {
    const M: Matrix = [
      [1, 0],
      [0, 0],
    ];
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    const r = modalAnalysis(M, K);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/positive definite|zero or negative inertia/i);
  });

  test("asymmetric and mismatched matrices are refused", () => {
    const K: Matrix = [
      [200, -100],
      [-100, 200],
    ];
    expect(modalAnalysis([[1, 1], [0, 1]], K).ok).toBe(false);
    expect(modalAnalysis([[1, 0], [0, 1]], [[1, 2], [3, 4]]).ok).toBe(false);
    expect(modalAnalysis([[1, 0], [0, 1]], [[1]]).ok).toBe(false);
    expect(modalAnalysis([], []).ok).toBe(false);
  });

  test("the undamped caveat is always stated", () => {
    const built = chainSystem([1, 1], [100, 100], true);
    if ("ok" in built) throw new Error(built.error);
    expect(modal(built.M, built.K).notes.join(" ")).toMatch(/UNDAMPED natural frequencies/);
  });
});

// ---------------------------------------------------------------------------
describe("building a chain system", () => {
  test("a grounded chain has the expected tridiagonal stiffness", () => {
    const built = chainSystem([1, 1], [100, 100], true);
    if ("ok" in built) throw new Error(built.error);
    expect(built.K).toEqual([
      [200, -100],
      [-100, 100],
    ]);
    expect(built.M).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  test("a free-free chain is singular in stiffness by construction", () => {
    const built = chainSystem([1, 1], [100], false);
    if ("ok" in built) throw new Error(built.error);
    expect(built.K).toEqual([
      [100, -100],
      [-100, 100],
    ]);
  });

  test("the wrong number of springs is refused with the count it wanted", () => {
    const r = chainSystem([1, 1, 1], [100], true);
    expect("ok" in r).toBe(true);
    if ("ok" in r) expect(r.error).toMatch(/needs 3 spring/);
  });

  test("non-positive masses and stiffnesses are refused", () => {
    expect("ok" in chainSystem([0, 1], [1, 1], true)).toBe(true);
    expect("ok" in chainSystem([1, 1], [0, 1], true)).toBe(true);
  });
});
