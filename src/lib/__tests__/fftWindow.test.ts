// Windowing: does it actually do the thing it is for, and does it keep the
// properties callers already relied on?

import { spectrum, dominantFrequencies, windowCoefficients, WindowKind } from "../fft";

const KINDS: WindowKind[] = ["none", "hann", "hamming", "blackman"];

/** A tone at a frequency deliberately BETWEEN bins — the leakage case. */
function offBinTone(n: number, fs: number, freq: number, amp = 1): number[] {
  return Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / fs));
}

describe("window coefficients", () => {
  it("are the textbook definitions at the ends and the middle", () => {
    const n = 65;
    const hann = windowCoefficients("hann", n);
    expect(hann[0]).toBeCloseTo(0, 12);
    expect(hann[n - 1]).toBeCloseTo(0, 12);
    expect(hann[(n - 1) / 2]).toBeCloseTo(1, 12);
    // Hamming does NOT reach zero at the ends — that is the difference.
    const hamming = windowCoefficients("hamming", n);
    expect(hamming[0]).toBeCloseTo(0.08, 12);
    expect(windowCoefficients("blackman", n)[0]).toBeCloseTo(0, 10);
  });

  it("none is all ones, and every window is symmetric and bounded", () => {
    expect(windowCoefficients("none", 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    for (const k of KINDS) {
      const w = windowCoefficients(k, 64);
      for (let i = 0; i < 32; i++) expect(w[i]).toBeCloseTo(w[63 - i], 12);
      for (const x of w) {
        expect(x).toBeGreaterThanOrEqual(-1e-12);
        expect(x).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });
});

describe("windowing suppresses leakage — the point of the change", () => {
  const fs = 1000;
  const n = 512;
  // 50.5 Hz against a 1.95 Hz bin spacing: maximally between bins.
  const sig = offBinTone(n, fs, 50.5);

  /** Total energy more than 10 bins away from the true tone. */
  function skirtEnergy(kind: WindowKind): number {
    const bins = spectrum(sig, fs, kind);
    const peakIdx = bins.reduce((b, x, i) => (x.magnitude > bins[b].magnitude ? i : b), 0);
    return bins.reduce((s, b, i) => (Math.abs(i - peakIdx) > 10 ? s + b.magnitude : s), 0);
  }

  it("every window leaks far less than no window at all", () => {
    const none = skirtEnergy("none");
    for (const k of ["hann", "hamming", "blackman"] as WindowKind[]) {
      expect(skirtEnergy(k)).toBeLessThan(none * 0.5);
    }
  });

  it("Blackman is the quietest far from the peak", () => {
    expect(skirtEnergy("blackman")).toBeLessThan(skirtEnergy("hann"));
  });
});

describe("amplitude stays honest — the correction is applied", () => {
  const fs = 1000;
  const n = 1024;

  it("an on-bin sinusoid of amplitude A reads ~A under every window", () => {
    // 1000/1024 * 64 = 62.5 Hz sits exactly on bin 64.
    const freq = (fs / n) * 64;
    const sig = offBinTone(n, fs, freq, 3);
    for (const k of KINDS) {
      const peak = spectrum(sig, fs, k).reduce((m, b) => (b.magnitude > m.magnitude ? b : m));
      expect(peak.freq).toBeCloseTo(freq, 6);
      expect(peak.magnitude).toBeGreaterThan(3 * 0.97);
      expect(peak.magnitude).toBeLessThan(3 * 1.03);
    }
  });

  it("windowing REDUCES scalloping loss for an off-bin tone", () => {
    // The old rectangular default lost ~36% of amplitude on a worst-case
    // off-bin tone; a window recovers most of it.
    const sig = offBinTone(1024, fs, 62.5 + (fs / 1024) * 0.5, 1);
    const peakOf = (k: WindowKind): number =>
      spectrum(sig, fs, k).reduce((m, b) => Math.max(m, b.magnitude), 0);
    expect(peakOf("hann")).toBeGreaterThan(peakOf("none"));
  });
});

describe("dominant frequencies pick PEAKS, not bins", () => {
  const fs = 1000;
  const sig = Array.from({ length: 512 }, (_, i) =>
    Math.sin((2 * Math.PI * 50 * i) / fs) + 0.5 * Math.sin((2 * Math.PI * 120 * i) / fs),
  );

  it("a two-tone signal returns the two tones, not one tone twice", () => {
    const dom = dominantFrequencies(sig, fs, 2);
    expect(dom).toHaveLength(2);
    const freqs = dom.map((d) => d.freq).sort((a, b) => a - b);
    expect(freqs[0]).toBeGreaterThan(48);
    expect(freqs[0]).toBeLessThan(52);
    expect(freqs[1]).toBeGreaterThan(118);
    expect(freqs[1]).toBeLessThan(122);
  });

  it("holds for every window — this was the regression windowing introduced", () => {
    for (const k of KINDS) {
      const dom = dominantFrequencies(sig, fs, 2, k);
      expect(dom).toHaveLength(2);
      const gap = Math.abs(dom[0].freq - dom[1].freq);
      expect(gap).toBeGreaterThan(20); // not two bins off the same peak
    }
  });

  it("the stronger tone comes first", () => {
    const dom = dominantFrequencies(sig, fs, 2);
    expect(dom[0].magnitude).toBeGreaterThan(dom[1].magnitude);
    expect(dom[0].freq).toBeLessThan(60); // the amplitude-1 tone at 50 Hz
  });

  it("a flat signal reports nothing under every window", () => {
    for (const k of KINDS) {
      expect(dominantFrequencies([5, 5, 5, 5, 5, 5, 5, 5], 8, 3, k)).toHaveLength(0);
      expect(dominantFrequencies([0, 0, 0, 0], 4, 3, k)).toHaveLength(0);
    }
  });

  it("a large DC offset does not drown the real tone", () => {
    // Removing the mean is what makes this work.
    const withOffset = sig.map((x) => x + 1000);
    const dom = dominantFrequencies(withOffset, fs, 1);
    expect(dom).toHaveLength(1);
    expect(dom[0].freq).toBeGreaterThan(48);
    expect(dom[0].freq).toBeLessThan(52);
  });
});
