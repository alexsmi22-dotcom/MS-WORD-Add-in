// Adversarial / edge-case bug test for the Phase 2 modules (optimization, FFT,
// ODE). Degenerate inputs and boundary conditions that tend to break numerical
// code. "Nothing ships without a bug test."

import { nelderMead } from "../optimize";
import { fft, ifft, spectrum, dominantFrequencies, nextPow2, fftInPlace } from "../fft";
import { integrate } from "../ode";

describe("optimization edge cases", () => {
  it("constant objective does not crash and returns a finite point", () => {
    const r = nelderMead(() => 7, [1, 2, 3]);
    expect(r.fx).toBe(7);
    expect(r.x.every(Number.isFinite)).toBe(true);
  });
  it("starting exactly at the minimum stays there", () => {
    const r = nelderMead((x) => x[0] * x[0], [0]);
    expect(Math.abs(r.x[0])).toBeLessThan(1e-3);
    expect(r.fx).toBeLessThan(1e-6);
  });
  it("minimizes a 4-D sphere", () => {
    const r = nelderMead((x) => x.reduce((s, v) => s + v * v, 0), [1, -1, 2, -2], { maxIter: 4000 });
    expect(r.fx).toBeLessThan(1e-6);
  });
  it("respects the iteration cap without throwing (reports not converged)", () => {
    const rosen = (x: number[]) => (1 - x[0]) ** 2 + 100 * (x[1] - x[0] * x[0]) ** 2;
    const r = nelderMead(rosen, [-1.2, 1], { maxIter: 5 });
    expect(r.iterations).toBeLessThanOrEqual(5);
    expect(Number.isFinite(r.fx)).toBe(true);
  });
});

describe("FFT edge cases", () => {
  it("non-power-of-two signal is zero-padded and still reconstructs its samples", () => {
    const x = [1, 2, 3, 4, 5]; // length 5 → padded to 8
    const F = fft(x);
    expect(F.re.length).toBe(8);
    const back = ifft(F.re, F.im);
    for (let i = 0; i < x.length; i++) expect(back.re[i]).toBeCloseTo(x[i], 9);
    for (let i = x.length; i < 8; i++) expect(back.re[i]).toBeCloseTo(0, 9); // padding stays zero
  });
  it("constant signal → all energy at DC, no non-zero dominant frequency", () => {
    const s = spectrum([5, 5, 5, 5], 4);
    expect(s[0].freq).toBe(0);
    expect(s[0].magnitude).toBeCloseTo(5, 9);
    for (let k = 1; k < s.length; k++) expect(s[k].magnitude).toBeCloseTo(0, 9);
    expect(dominantFrequencies([5, 5, 5, 5], 4, 3)).toHaveLength(0);
  });
  it("too-short signal yields an empty spectrum", () => {
    expect(spectrum([42], 10)).toEqual([]);
    expect(spectrum([], 10)).toEqual([]);
  });
  it("rejects a non-power-of-two length in the in-place core", () => {
    expect(() => fftInPlace([1, 2, 3], [0, 0, 0])).toThrow();
  });
  it("nextPow2 boundaries", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(1023)).toBe(1024);
  });
});

describe("ODE edge cases", () => {
  it("zero-length interval returns the initial state and is complete", () => {
    const r = integrate((_t, y) => [y[0]], [3], 2, 2);
    expect(r.completed).toBe(true);
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(3, 12);
  });
  it("constant derivative gives a straight line", () => {
    const r = integrate(() => [2], [1], 0, 3); // y = 1 + 2t
    expect(r.y[r.y.length - 1][0]).toBeCloseTo(7, 6);
  });
  it("independent coupled variables integrate separately", () => {
    // y1' = -y1, y2' = 2 ; y1 = e^-t, y2 = 2t
    const r = integrate((_t, y) => [-y[0], 2], [1, 0], 0, 3);
    const end = r.y[r.y.length - 1];
    expect(end[0]).toBeCloseTo(Math.exp(-3), 5);
    expect(end[1]).toBeCloseTo(6, 5);
  });
  it("finite-time blow-up does not hang and reports not completed", () => {
    // y' = y^2, y0 = 1 → blows up at t = 1; integrating to 5 must not reach the end
    const r = integrate((_t, y) => [y[0] * y[0]], [1], 0, 5, { maxSteps: 20000 });
    expect(r.completed).toBe(false);
    expect(r.t[r.t.length - 1]).toBeLessThan(5);
  });
});
