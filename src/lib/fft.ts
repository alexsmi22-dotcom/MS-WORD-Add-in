// FFT & basic spectral analysis.
//
// Radix-2 Cooley–Tukey (iterative, in-place with bit-reversal). Inputs of any
// length are zero-padded to the next power of two — simple and standard; the
// caller is told the padded length so it can interpret the frequency bins. Also
// provides a one-sided magnitude spectrum with real frequency axis from a sample
// rate, and a dominant-frequency finder. Pure; no external deps.

export interface ComplexArray {
  re: number[];
  im: number[];
}

/** Smallest power of two ≥ n (n ≥ 1). */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * In-place iterative radix-2 FFT. `re`/`im` must have a power-of-two length
 * (use zeroPad first). `inverse` computes the IFFT (with 1/N normalization).
 */
export function fftInPlace(re: number[], im: number[], inverse = false): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error("FFT length must be a power of two.");
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Zero-pads (a copy of) the arrays to the next power of two. */
function zeroPad(re: number[], im: number[]): ComplexArray {
  const n = nextPow2(re.length);
  const r = re.slice();
  const i = im.slice();
  while (r.length < n) {
    r.push(0);
    i.push(0);
  }
  return { re: r, im: i };
}

/** Forward FFT of a (real or complex) signal; zero-pads to a power of two. */
export function fft(re: number[], im?: number[]): ComplexArray {
  const out = zeroPad(re, im ?? new Array(re.length).fill(0));
  fftInPlace(out.re, out.im, false);
  return out;
}

/** Inverse FFT; zero-pads to a power of two. */
export function ifft(re: number[], im: number[]): ComplexArray {
  const out = zeroPad(re, im);
  fftInPlace(out.re, out.im, true);
  return out;
}

export interface SpectrumBin {
  /** Frequency in the same time unit⁻¹ as the sample rate (e.g. Hz). */
  freq: number;
  magnitude: number;
  /** Phase in radians. */
  phase: number;
}

/**
 * One-sided amplitude spectrum of a real signal sampled at `sampleRate`.
 * Returns bins from 0 up to the Nyquist frequency, with amplitudes scaled so a
 * pure sinusoid of amplitude A reads ~A at its frequency.
 */
export function spectrum(signal: number[], sampleRate: number): SpectrumBin[] {
  if (signal.length < 2) return [];
  const { re, im } = fft(signal);
  const n = re.length; // padded length
  const half = Math.floor(n / 2);
  const bins: SpectrumBin[] = [];
  for (let k = 0; k <= half; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    // scale: DC and Nyquist by 1/N, the rest by 2/N (single-sided)
    const scale = k === 0 || k === half ? 1 / n : 2 / n;
    bins.push({ freq: (k * sampleRate) / n, magnitude: mag * scale, phase: Math.atan2(im[k], re[k]) });
  }
  return bins;
}

/**
 * The `count` strongest non-DC frequency components, by amplitude. Bins whose
 * amplitude is negligible relative to the largest are dropped, so a signal with
 * no real oscillation (e.g. a constant) returns nothing rather than reporting a
 * meaningless zero-amplitude "peak".
 */
export function dominantFrequencies(signal: number[], sampleRate: number, count = 3): SpectrumBin[] {
  const bins = spectrum(signal, sampleRate).filter((b) => b.freq > 0);
  const maxMag = bins.reduce((m, b) => Math.max(m, b.magnitude), 0);
  if (maxMag <= 1e-12) return [];
  return bins
    .filter((b) => b.magnitude > 1e-6 * maxMag)
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, count);
}
