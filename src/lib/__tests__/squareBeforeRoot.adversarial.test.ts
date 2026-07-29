// One idiom, six places, all of them wrong the same way.
//
// `Math.sqrt(a*a + b*b)` and `x*y` formed before a division are the same mistake:
// the INTERMEDIATE overflows at about 1.3e154 while the ANSWER is an ordinary
// number the format holds easily. Nothing fails loudly — you get Infinity, NaN,
// a silent zero, or an iteration that never converges.
//
// It came up three times in one week's work before anyone went looking for it as
// a class:
//
//   re^2 + im^2   in the modal solver      -> refused a representable response
//   |phi| * |F|   in the nodal-force test  -> called a resonating mode a node
//   dx^2 + dy^2   in geometry              -> reported a distance of Infinity
//
// A systematic sweep for the shape then found three more, one of which could not
// be worked around at all: a matrix of 1e160 entries has eigenvalues near 1e160,
// and `eigenvaluesGeneral` THREW "did not converge" on it, because the overflow
// became a NaN that the iteration could never settle.
//
// So this file tests the CLASS, at every site, rather than each fix in its own
// module. The rule it encodes: prefer `Math.hypot`, divide before multiplying,
// and scale a matrix before iterating on it.

import { eigenvaluesGeneral, Matrix } from "../linalg";
import { spectrum } from "../fft";
import { magnification, transmissibility } from "../vibration";
import { solveGeometry } from "../geometryParse";

const finite = (v: number) => Number.isFinite(v);

describe("eigenvalues of a large-entry matrix", () => {
  test("a 1e160 matrix solves instead of failing to converge", () => {
    const A: Matrix = [
      [1e160, 2e160, 0],
      [3e160, 1e160, 1e160],
      [0, 1e160, 2e160],
    ];
    const ev = eigenvaluesGeneral(A);
    expect(ev).not.toBeNull();
    for (const c of ev!) expect({ re: finite(c.re), im: finite(c.im) }).toEqual({ re: true, im: true });
    // Independent check: the eigenvalues sum to the trace.
    const trace = 1e160 + 1e160 + 2e160;
    const sum = ev!.reduce((s, c) => s + c.re, 0);
    expect(Math.abs(sum - trace) / trace).toBeLessThan(1e-9);
  });

  test("a rank-one 1e200 matrix gives the exact analytic answer", () => {
    // [[c,c],[c,c]] has eigenvalues 2c and 0.
    const ev = eigenvaluesGeneral([
      [1e200, 1e200],
      [1e200, 1e200],
    ]);
    expect(ev).not.toBeNull();
    const re = ev!.map((c) => c.re).sort((a, b) => b - a);
    expect(re[0] / 2e200).toBeCloseTo(1, 6);
    expect(Math.abs(re[1])).toBeLessThan(1e185);
  });

  test("scaling did not disturb ordinary matrices", () => {
    // [[2,0],[0,3]] must still be exactly 3 and 2.
    const ev = eigenvaluesGeneral([
      [2, 0],
      [0, 3],
    ]);
    const re = ev!.map((c) => c.re).sort((a, b) => b - a);
    expect(re).toEqual([3, 2]);
  });

  test("tiny-entry matrices work too", () => {
    const ev = eigenvaluesGeneral([
      [1e-200, 0],
      [0, 2e-200],
    ]);
    const re = ev!.map((c) => c.re).sort((a, b) => b - a);
    expect(re[0] / 2e-200).toBeCloseTo(1, 6);
  });
});

describe("FFT magnitudes at large amplitude", () => {
  test.each([1e150, 1e155, 1e200, 1e300])("amplitude %s gives finite bins", (amp) => {
    const sig = Array.from({ length: 16 }, (_, i) => amp * Math.cos(i));
    for (const b of spectrum(sig, 100)) {
      expect({ amp, ok: finite(b.magnitude) }).toEqual({ amp, ok: true });
    }
  });

  test("ordinary signals are unchanged", () => {
    const sig = Array.from({ length: 16 }, (_, i) => Math.cos(i));
    const m = spectrum(sig, 100).map((b) => b.magnitude);
    expect(m.every(finite)).toBe(true);
    expect(Math.max(...m)).toBeGreaterThan(0);
  });
});

describe("SDOF magnification and transmissibility at extreme frequency ratios", () => {
  test.each([1e77, 1e100, 1e154, 1e155, 1e200])("r = %s stays finite and correct", (r) => {
    const zeta = 0.05;
    const mag = magnification(r, zeta);
    const tr = transmissibility(r, zeta);
    expect({ r, mag: finite(mag), tr: finite(tr) }).toEqual({ r, mag: true, tr: true });
    // Analytic limits well above resonance: M -> 1/r^2, T -> 2*zeta/r.
    const magTruth = 1 / (r * r);
    const trTruth = (2 * zeta) / r;
    if (magTruth > 0) expect(Math.abs(mag - magTruth) / magTruth).toBeLessThan(1e-6);
    expect(Math.abs(tr - trTruth) / trTruth).toBeLessThan(1e-6);
  });

  test("the ordinary range is untouched", () => {
    // Peak of the magnification curve is at r = sqrt(1 - 2 zeta^2).
    const zeta = 0.1;
    const rPeak = Math.sqrt(1 - 2 * zeta * zeta);
    expect(magnification(rPeak, zeta)).toBeCloseTo(1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)), 9);
    // Transmissibility is exactly 1 at r = sqrt(2), for every damping ratio.
    for (const z of [0, 0.05, 0.3, 1, 5]) {
      expect(transmissibility(Math.SQRT2, z)).toBeCloseTo(1, 12);
    }
    expect(magnification(0, 0.1)).toBeCloseTo(1, 12);
    expect(transmissibility(0, 0.1)).toBeCloseTo(1, 12);
  });
});

describe("geometry distances at large coordinates", () => {
  test("a 200-digit coordinate gives the real distance, not Infinity", () => {
    const big = "9".repeat(200);
    const r = solveGeometry(`distance (0,0) (${big},${big})`) as {
      values?: { label: string; value: number }[];
    } | null;
    const d = r?.values?.find((v) => v.label === "distance")?.value;
    expect(d).toBeDefined();
    expect(finite(d!)).toBe(true);
    // sqrt(2) * 1e200, to the precision the coordinate carries.
    expect(d! / 1e200).toBeCloseTo(Math.SQRT2, 6);
  });

  test("ordinary distances are unchanged", () => {
    const r = solveGeometry("distance (0,0) (3,4)") as {
      values?: { label: string; value: number }[];
    } | null;
    expect(r?.values?.find((v) => v.label === "distance")?.value).toBe(5);
  });
});
