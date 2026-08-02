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

export type WindowKind = "none" | "hann" | "hamming" | "blackman";

/**
 * Window functions, and why the default is no longer "none".
 *
 * THE PROBLEM THEY SOLVE IS ALWAYS PRESENT, NOT AN EDGE CASE. An FFT assumes
 * the record repeats forever. Unless the signal happens to contain a whole
 * number of cycles — which real data never does — the wrap-around leaves a
 * discontinuity, and that discontinuity is broadband: energy from one real tone
 * smears across every bin. The result looks like structure. A user reading a
 * spectrum of a clean 50 Hz tone sees skirts either side of it and reasonably
 * concludes there is something there.
 *
 * Every window trades the same two things: a MAIN LOBE that gets wider (so two
 * close tones are harder to separate) against SIDE LOBES that get lower (so a
 * weak tone beside a strong one stops being buried). Hann is the standard
 * general-purpose choice and is the default here; Hamming cancels the first
 * side lobe harder at the cost of a worse far-off floor; Blackman is the
 * quietest and the bluntest.
 *
 * AMPLITUDE IS CORRECTED. A window multiplies the signal by something with a
 * mean below 1, so an uncorrected windowed spectrum understates every amplitude
 * — Hann by a factor of two. Dividing by the window's mean (its coherent gain)
 * restores the property the caller depends on: a sinusoid of amplitude A reads
 * ~A.
 */
export function windowCoefficients(kind: WindowKind, n: number): number[] {
  if (kind === "none" || n <= 1) return new Array(n).fill(1);
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1);
    if (kind === "hann") w[i] = 0.5 - 0.5 * Math.cos(x);
    else if (kind === "hamming") w[i] = 0.54 - 0.46 * Math.cos(x);
    else w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x); // blackman
  }
  return w;
}

/**
 * One-sided amplitude spectrum of a real signal sampled at `sampleRate`.
 * Returns bins from 0 up to the Nyquist frequency, with amplitudes scaled so a
 * pure sinusoid of amplitude A reads ~A at its frequency.
 *
 * `window` defaults to Hann. It used to be no window at all, which meant every
 * spectrum this product has ever drawn carried leakage skirts around every real
 * tone — see windowCoefficients. Pass "none" to reproduce the old behaviour.
 */
export function spectrum(signal: number[], sampleRate: number, window: WindowKind = "hann"): SpectrumBin[] {
  if (signal.length < 2) return [];
  const w = windowCoefficients(window, signal.length);
  // Coherent gain: the window's mean. Dividing by it keeps amplitudes honest.
  const gain = w.reduce((s, x) => s + x, 0) / w.length;
  const windowed = signal.map((x, i) => x * w[i]);
  const { re, im } = fft(windowed);
  if (gain > 0 && gain !== 1) {
    for (let i = 0; i < re.length; i++) {
      re[i] /= gain;
      im[i] /= gain;
    }
  }
  const n = re.length; // padded length
  const half = Math.floor(n / 2);
  const bins: SpectrumBin[] = [];
  for (let k = 0; k <= half; k++) {
    // Math.hypot: squaring first overflows for sample amplitudes past ~1e154 and
    // reports every bin as Infinity, when the true magnitudes are ordinary
    // numbers a double holds comfortably.
    const mag = Math.hypot(re[k], im[k]);
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
export function dominantFrequencies(
  signal: number[],
  sampleRate: number,
  count = 3,
  window: WindowKind = "hann",
): SpectrumBin[] {
  // THE MEAN IS REMOVED FIRST, and windowing is why it must be. A window
  // multiplies the signal by a smooth bump, so a CONSTANT signal comes out as
  // the shape of the window — which has energy in the bins either side of DC.
  // Without this line, adding windowing made a flat signal report a confident
  // dominant frequency where the old code correctly reported none. Removing the
  // mean is standard practice for spectral analysis in any case: DC is not an
  // oscillation, and it is the one component this function never reports.
  const mean = signal.reduce((s, x) => s + x, 0) / signal.length;
  const centred = signal.map((x) => x - mean);

  const bins = spectrum(centred, sampleRate, window).filter((b) => b.freq > 0);
  const maxMag = bins.reduce((m, b) => Math.max(m, b.magnitude), 0);
  // Relative to the signal's own scale, so "negligible" means negligible for
  // this data rather than in absolute units.
  const scale = Math.max(Math.abs(mean), ...signal.map(Math.abs), 1e-300);
  if (maxMag <= 1e-12 || maxMag < 1e-9 * scale) return [];

  // PEAKS, NOT BINS. Taking the top N bins by magnitude reports one tone
  // several times: a real peak occupies more than one bin, and a window makes
  // the main lobe WIDER still (that is the price paid for lower side lobes).
  // Introducing windowing without this made a clean two-tone signal report its
  // 50 Hz component twice, from two adjacent bins, and drop the second tone off
  // the list entirely — a regression the existing test caught immediately.
  //
  // So: keep only local maxima, then select greedily while excluding anything
  // inside the main lobe of a peak already taken. Hann's main lobe is four bins
  // wide, so a three-bin exclusion either side separates genuinely distinct
  // tones without merging them.
  const lobeBins = window === "none" ? 1 : 3;
  const isLocalMax = (i: number): boolean =>
    (i === 0 || bins[i].magnitude >= bins[i - 1].magnitude) &&
    (i === bins.length - 1 || bins[i].magnitude >= bins[i + 1].magnitude);

  const candidates = bins
    .map((b, i) => ({ b, i }))
    .filter((x) => x.b.magnitude > 1e-6 * maxMag && isLocalMax(x.i))
    .sort((a, b) => b.b.magnitude - a.b.magnitude);

  const chosen: { b: SpectrumBin; i: number }[] = [];
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (chosen.some((k) => Math.abs(k.i - c.i) <= lobeBins)) continue;
    chosen.push(c);
  }
  return chosen.map((c) => c.b);
}
