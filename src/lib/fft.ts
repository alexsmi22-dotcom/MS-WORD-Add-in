// FFT & basic spectral analysis.
//
// Radix-2 Cooley–Tukey (iterative, in-place with bit-reversal). `fft`/`ifft`
// zero-pad to the next power of two (fftfilter relies on that); the spectrum
// and dominant-frequency finder use `dftExact` (Bluestein), which keeps the
// record's own length so the bins sit on k·fs/N. Pure; no external deps.

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

/**
 * Exact-length DFT of a real signal (any length) by Bluestein's chirp-z
 * algorithm on power-of-two FFTs. Unlike `fft`, nothing is zero-padded, so the
 * bins sit on k·fs/N — the grid numpy.fft.rfft uses — and a tone with a whole
 * number of cycles in the record lands exactly on a bin.
 */
export function dftExact(x: number[]): ComplexArray {
  const n = x.length;
  if (n <= 1 || (n & (n - 1)) === 0) return fft(x);
  const m = nextPow2(2 * n - 1);
  // chirp w_k = exp(−iπk²/n); k² mod 2n keeps the angle exact for large k.
  const cRe = new Array<number>(n);
  const cIm = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const k2 = (k * k) % (2 * n);
    const a = (Math.PI * k2) / n;
    cRe[k] = Math.cos(a);
    cIm[k] = -Math.sin(a);
  }
  const aRe = new Array<number>(m).fill(0);
  const aIm = new Array<number>(m).fill(0);
  for (let k = 0; k < n; k++) {
    aRe[k] = x[k] * cRe[k];
    aIm[k] = x[k] * cIm[k];
  }
  const bRe = new Array<number>(m).fill(0);
  const bIm = new Array<number>(m).fill(0);
  bRe[0] = cRe[0];
  bIm[0] = -cIm[0];
  for (let k = 1; k < n; k++) {
    bRe[k] = bRe[m - k] = cRe[k];
    bIm[k] = bIm[m - k] = -cIm[k];
  }
  fftInPlace(aRe, aIm);
  fftInPlace(bRe, bIm);
  for (let k = 0; k < m; k++) {
    const r = aRe[k] * bRe[k] - aIm[k] * bIm[k];
    aIm[k] = aRe[k] * bIm[k] + aIm[k] * bRe[k];
    aRe[k] = r;
  }
  fftInPlace(aRe, aIm, true);
  const re = new Array<number>(n);
  const im = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    re[k] = aRe[k] * cRe[k] - aIm[k] * cIm[k];
    im[k] = aRe[k] * cIm[k] + aIm[k] * cRe[k];
  }
  return { re, im };
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
//
// PERIODIC, NOT SYMMETRIC. The phase is 2πi/n, not 2πi/(n − 1). The symmetric
// form is for FIR filter design; for spectral analysis the window must repeat
// with the record, otherwise an on-bin tone leaks and its coherent gain is off
// (the 8-sample Hann default example read 0.875 for a unit sine instead of 1).
export function windowCoefficients(kind: WindowKind, n: number): number[] {
  if (kind === "none" || n <= 1) return new Array(n).fill(1);
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
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
  const w =windowCoefficients(window, signal.length);
  return spectrumOf(
    signal.map((x, i) => x * w[i]),
    signal.length,
    window,
    sampleRate,
  );
}

/**
 * The shared pipeline (spectrum plot AND dominantFrequencies): exact-length DFT
 * of the already-windowed samples, scaled by the window SUM.
 *
 * This used to zero-pad to a power of two and divide by the PADDED length, so a
 * unit 10 Hz sine of 100 samples at 100 Hz read 0.78 (and its peak fell between
 * bins). Now the grid is k·fs/N and the scale 2/Σw: Σw is N for no window
 * (the textbook 2/N rule) and the coherent-gain correction for every other.
 */
function spectrumOf(windowed: number[], nOrig: number, window: WindowKind, sampleRate: number): SpectrumBin[] {
  const w = windowCoefficients(window, nOrig);
  const sumW = w.reduce((s, x) => s + x, 0);
  const { re, im } = dftExact(windowed);
  const n = re.length; // = nOrig: no padding, bins on k·fs/N
  const half = Math.floor(n / 2);
  const nyquist = n % 2 === 0;
  const norm = sumW > 0 ? sumW : nOrig;
  const bins: SpectrumBin[] = [];
  for (let k = 0; k <= half; k++) {
    // Math.hypot: squaring first overflows for sample amplitudes past ~1e154 and
    // reports every bin as Infinity, when the true magnitudes are ordinary
    // numbers a double holds comfortably.
    const mag = Math.hypot(re[k], im[k]);
    // scale: DC and Nyquist by 1/Σw, the rest by 2/Σw (single-sided)
    const scale = k === 0 || (nyquist && k === half) ? 1 / norm : 2 / norm;
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
  if (signal.length < 2) return [];
  // THE DC IS REMOVED AFTER WINDOWING, as the window-weighted mean
  // μw = Σ w·x / Σ w (exactly the DC bin of the plotted spectrum). Subtracting
  // μw·w from the windowed record removes the DC bin AND its leakage, so a
  // constant reports nothing. The old code subtracted the plain sample mean
  // BEFORE windowing; for a tone with a partial cycle that mean is not the DC,
  // and the window turned the subtracted constant into a false 1-bin "tone"
  // (a 5.5 Hz sine reported a 1 Hz peak). This is the spectrum plot's pipeline
  // with only the DC component taken out.
  const mean = signal.reduce((s, x) => s + x, 0) / signal.length;
  const w = windowCoefficients(window, signal.length);
  const sumW = w.reduce((s, x) => s + x, 0);
  const muW = sumW > 0 ? signal.reduce((s, x, i) => s + w[i] * x, 0) / sumW : mean;
  const windowed = signal.map((x, i) => (x - muW) * w[i]);

  const bins = spectrumOf(windowed, signal.length, window, sampleRate).filter((b) => b.freq > 0);
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

  // A local maximum below the window's highest side lobe (relative to the
  // strongest peak) cannot be told apart from that peak's own leakage, so it is
  // not reported as a "dominant frequency" (Hann −31.5 dB, Hamming −42.7 dB,
  // Blackman −58.1 dB, rectangular −13.3 dB; each floor sits just above).
  const sideLobe = window === "hann" ? 0.03 : window === "hamming" ? 0.01 : window === "blackman" ? 0.002 : 0.25;
  const candidates = bins
    .map((b, i) => ({ b, i }))
    .filter((x) => x.b.magnitude > sideLobe * maxMag && isLocalMax(x.i))
    .sort((a, b) => b.b.magnitude - a.b.magnitude);

  const chosen: { b: SpectrumBin; i: number }[] = [];
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (chosen.some((k) => Math.abs(k.i - c.i) <= lobeBins)) continue;
    chosen.push(c);
  }
  return chosen.map((c) => c.b);
}
