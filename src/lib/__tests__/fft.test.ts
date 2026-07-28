// Dedicated tests for fft.ts.
//
// This module had no suite of its own — it was exercised only as a helper
// inside fftfilter.test.ts, so its own exports went unchecked. The oracles here
// are mathematical identities rather than recorded outputs, which is what makes
// them worth having: PARSEVAL'S THEOREM (energy is conserved between the time
// and frequency domains) and ROUND-TRIP INVERSION would both break under a
// wrong twiddle factor, a wrong normalisation or a mis-ordered bit reversal,
// and none of those show up as an obviously wrong-looking spectrum.

import { fft, ifft, fftInPlace, nextPow2, spectrum, dominantFrequencies } from "../fft";

const near = (a: number, b: number, tol = 1e-9): void =>
  expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

describe("nextPow2", () => {
  test("rounds up to a power of two and leaves powers of two alone", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(3)).toBe(4);
    expect(nextPow2(1000)).toBe(1024);
    expect(nextPow2(1024)).toBe(1024);
  });
});

describe("known transforms", () => {
  test("a constant signal puts all its energy in bin 0", () => {
    const n = 16;
    const re = new Array(n).fill(2);
    const out = fft(re);
    near(out.re[0], 2 * n);
    for (let k = 1; k < n; k++) {
      expect(Math.hypot(out.re[k], out.im[k])).toBeLessThan(1e-9);
    }
  });

  test("a single impulse transforms to a flat magnitude spectrum", () => {
    const n = 16;
    const re = new Array(n).fill(0);
    re[0] = 1;
    const out = fft(re);
    for (let k = 0; k < n; k++) near(Math.hypot(out.re[k], out.im[k]), 1);
  });

  test("a pure sinusoid at an exact bin lands in that bin and its mirror", () => {
    const n = 64;
    const bin = 5;
    const re = Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * bin * t) / n));
    const out = fft(re);
    const mag = Array.from({ length: n }, (_, k) => Math.hypot(out.re[k], out.im[k]));
    near(mag[bin], n / 2, 1e-8);
    near(mag[n - bin], n / 2, 1e-8);
    for (let k = 0; k < n; k++) {
      if (k === bin || k === n - bin) continue;
      expect(mag[k]).toBeLessThan(1e-8);
    }
  });
});

describe("identities that a wrong implementation cannot satisfy", () => {
  test("Parseval: energy is conserved between the domains", () => {
    const n = 32;
    const re = Array.from({ length: n }, (_, t) => Math.sin(t) + 0.5 * Math.cos(3 * t) + 0.2);
    const timeEnergy = re.reduce((a, x) => a + x * x, 0);
    const out = fft(re);
    let freqEnergy = 0;
    for (let k = 0; k < n; k++) freqEnergy += out.re[k] * out.re[k] + out.im[k] * out.im[k];
    near(freqEnergy / n, timeEnergy, 1e-9);
  });

  test("the inverse transform recovers the original signal", () => {
    const n = 64;
    const re = Array.from({ length: n }, (_, t) => Math.sin(0.3 * t) * Math.exp(-t / 40) + 0.1 * t);
    const im = new Array(n).fill(0);
    const f = fft(re, im);
    const back = ifft(f.re, f.im);
    for (let t = 0; t < n; t++) {
      near(back.re[t], re[t], 1e-9);
      expect(Math.abs(back.im[t])).toBeLessThan(1e-9);
    }
  });

  test("linearity: the transform of a sum is the sum of the transforms", () => {
    const n = 32;
    const a = Array.from({ length: n }, (_, t) => Math.sin(t));
    const b = Array.from({ length: n }, (_, t) => Math.cos(2 * t));
    const fa = fft(a);
    const fb = fft(b);
    const fab = fft(a.map((x, i) => x + b[i]));
    for (let k = 0; k < n; k++) {
      near(fab.re[k], fa.re[k] + fb.re[k], 1e-9);
      near(fab.im[k], fa.im[k] + fb.im[k], 1e-9);
    }
  });

  test("a real signal has a conjugate-symmetric spectrum", () => {
    const n = 32;
    const re = Array.from({ length: n }, (_, t) => Math.sin(0.7 * t) + 0.3);
    const out = fft(re);
    for (let k = 1; k < n / 2; k++) {
      near(out.re[k], out.re[n - k], 1e-9);
      near(out.im[k], -out.im[n - k], 1e-9);
    }
  });

  test("fftInPlace and fft agree", () => {
    const n = 16;
    const re = Array.from({ length: n }, (_, t) => t % 5);
    const im = new Array(n).fill(0);
    const copyRe = [...re];
    const copyIm = [...im];
    fftInPlace(copyRe, copyIm);
    const out = fft(re, im);
    for (let k = 0; k < n; k++) {
      near(copyRe[k], out.re[k], 1e-9);
      near(copyIm[k], out.im[k], 1e-9);
    }
  });
});

describe("spectrum and dominant frequencies", () => {
  test("a 50 Hz tone sampled at 1 kHz is found at 50 Hz", () => {
    const rate = 1000;
    const n = 1024;
    const signal = Array.from({ length: n }, (_, t) => Math.sin((2 * Math.PI * 50 * t) / rate));
    const top = dominantFrequencies(signal, rate, 1);
    expect(Math.abs(top[0].freq - 50)).toBeLessThan(1.5);
  });

  test("two tones are both found, strongest first", () => {
    const rate = 1000;
    const n = 1024;
    const signal = Array.from(
      { length: n },
      (_, t) => Math.sin((2 * Math.PI * 50 * t) / rate) + 0.4 * Math.sin((2 * Math.PI * 120 * t) / rate),
    );
    const top = dominantFrequencies(signal, rate, 2);
    expect(top.length).toBe(2);
    expect(top[0].magnitude).toBeGreaterThanOrEqual(top[1].magnitude);
    const found = top.map((b) => Math.round(b.freq / 10) * 10).sort((a, b) => a - b);
    expect(found).toEqual([50, 120]);
  });

  test("a silent signal reports no dominant frequency rather than a zero-amplitude one", () => {
    // Reporting zero-amplitude peaks was a real bug found by the phase-2
    // adversarial pass; a flat signal has no dominant frequency to name.
    const top = dominantFrequencies(new Array(256).fill(0), 1000, 3);
    expect(top.every((b) => b.magnitude === 0)).toBe(true);
  });

  test("bins run from DC to Nyquist and no further", () => {
    const rate = 800;
    const bins = spectrum(Array.from({ length: 256 }, (_, t) => Math.sin(t)), rate);
    expect(bins[0].freq).toBeCloseTo(0, 9);
    for (const b of bins) expect(b.freq).toBeLessThanOrEqual(rate / 2 + 1e-9);
  });
});
