// Frequency-domain filtering — low-pass, high-pass, band-pass, band-stop.
//
// TWO ARTEFACTS MAKE THE NAIVE VERSION WRONG, and neither announces itself. The
// output is smooth, plausible, and plots beautifully. That is what makes them
// dangerous rather than merely annoying.
//
// 1. GIBBS RINGING. Zeroing bins outright is a brick-wall filter — a rectangle in
//    frequency, which is a sinc in time. Convolving with a sinc rings: a clean step
//    comes back with oscillations either side of every edge, and those oscillations
//    look exactly like real features of the data. The fix is a smooth (raised-
//    cosine) transition band instead of a cliff. This module defaults to one and
//    lets you ask for the brick wall explicitly, with a warning.
//
// 2. CIRCULAR WRAPAROUND. The DFT treats the signal as periodic, so filtering is a
//    CIRCULAR convolution: the end of the record bleeds into the beginning. If your
//    first and last samples differ, the FFT sees a discontinuity that is not in your
//    data, and both ends come back corrupted. This module measures the end-to-end
//    step and warns when it is large enough to matter.
//
// Plus the ordinary one: zero-padding to a power of two changes the record length,
// so the frequency bins are not the ones a naive N would give.
//
// Pure numerics — no Office.js.

import { fft, ifft, nextPow2 } from "./fft";

export type FilterKind = "lowpass" | "highpass" | "bandpass" | "bandstop";

export interface FilterOptions {
  /** Cutoff (Hz) for low/high-pass; the LOW edge for band-pass/stop. */
  cutoff: number;
  /** The HIGH edge (Hz) for band-pass/band-stop. Ignored otherwise. */
  cutoffHigh?: number;
  /**
   * Width of the raised-cosine transition band, in Hz. Default: 10% of the cutoff.
   * Set to 0 for a brick wall — which rings. See the module header.
   */
  transition?: number;
}

export interface FilterResult {
  /** The filtered signal, trimmed back to the input length. */
  signal: number[];
  kind: FilterKind;
  /** Length the FFT actually ran at (a power of two). */
  paddedLength: number;
  /** Frequency resolution of the transform, Hz per bin. */
  binWidth: number;
  caveats: string[];
}

/**
 * Gain of the filter at frequency f, with a raised-cosine transition.
 *
 * The transition is what separates this from a brick wall. `t` is the full width of
 * the ramp; the gain goes 1 -> 0 as a half cosine across it rather than falling off
 * a cliff.
 */
function gainAt(f: number, kind: FilterKind, lo: number, hi: number, t: number): number {
  /** Smooth 1 -> 0 as f crosses `edge` going up, over width t. */
  const rollOff = (x: number, edge: number): number => {
    if (t <= 0) return x <= edge ? 1 : 0;
    const a = edge - t / 2;
    const b = edge + t / 2;
    if (x <= a) return 1;
    if (x >= b) return 0;
    return 0.5 * (1 + Math.cos((Math.PI * (x - a)) / t));
  };
  /** Smooth 0 -> 1 as f crosses `edge` going up. */
  const rollOn = (x: number, edge: number): number => 1 - rollOff(x, edge);

  switch (kind) {
    case "lowpass":
      return rollOff(f, lo);
    case "highpass":
      return rollOn(f, lo);
    case "bandpass":
      return rollOn(f, lo) * rollOff(f, hi);
    case "bandstop":
      // 1 everywhere except inside the band. Built from the two edges so the
      // transitions stay smooth on both sides.
      return 1 - rollOn(f, lo) * rollOff(f, hi);
  }
}

/**
 * Filters `signal` in the frequency domain.
 *
 * Returns null on inputs that cannot produce a meaningful answer, rather than
 * returning a filtered-looking array.
 */
export function fftFilter(
  signal: number[],
  sampleRate: number,
  kind: FilterKind,
  opts: FilterOptions
): FilterResult | null {
  const n = signal.length;
  if (n < 4 || !(sampleRate > 0)) return null;
  const nyquist = sampleRate / 2;
  const lo = opts.cutoff;
  const hi = opts.cutoffHigh ?? nyquist;
  if (!(lo > 0)) return null;
  if ((kind === "bandpass" || kind === "bandstop") && !(hi > lo)) return null;

  const t = opts.transition ?? Math.max(lo * 0.1, sampleRate / n);
  const N = nextPow2(n);
  const binWidth = sampleRate / N;
  const caveats: string[] = [];

  // Transform, scale each bin by the gain at its frequency, transform back.
  const spec = fft(signal);
  for (let k = 0; k < N; k++) {
    // Bins above N/2 are the negative frequencies; they mirror the positive ones
    // and MUST get the same gain or the result is not real-valued.
    const f = (k <= N / 2 ? k : N - k) * binWidth;
    const g = gainAt(f, kind, lo, hi, t);
    spec.re[k] *= g;
    spec.im[k] *= g;
  }
  const back = ifft(spec.re, spec.im);
  const out = back.re.slice(0, n);

  // --- the honest part ------------------------------------------------------
  if (lo >= nyquist && kind === "lowpass") {
    caveats.push(
      `The cutoff (${lo} Hz) is at or above the Nyquist frequency (${nyquist} Hz), so this ` +
        "low-pass removes nothing. Frequencies above Nyquist were never in the sampled data " +
        "to begin with — if you expected to remove something up there, it has already been " +
        "ALIASED down into your signal and no filter can recover it."
    );
  }

  // Circular wraparound: the DFT assumes periodicity, so a real discontinuity at the
  // join corrupts both ends.
  //
  // The comparison is the WRAP STEP against the TYPICAL STEP — not signal[0] vs
  // signal[n-1]. A perfectly periodic record's last sample sits one sample BEFORE
  // the wrap point, so its ends are SUPPOSED to differ by about one step: a clean
  // 12.5 Hz sine over exactly 32 cycles ends at -0.38 with a per-sample step of
  // 0.39. Comparing the endpoints directly flagged every clean sine — a warning that
  // fires on good data is worse than none, because it trains the reader to ignore it.
  const wrapStep = Math.abs(signal[0] - signal[n - 1]);
  let stepSum = 0;
  for (let i = 1; i < n; i++) stepSum += Math.abs(signal[i] - signal[i - 1]);
  const typicalStep = stepSum / (n - 1);
  const span = Math.max(...signal) - Math.min(...signal);
  if (span > 0 && typicalStep > 0 && wrapStep > 8 * typicalStep && wrapStep / span > 0.1) {
    caveats.push(
      `The signal starts at ${signal[0].toPrecision(4)} and ends at ${signal[n - 1].toPrecision(4)} — ` +
        `a jump of ${((wrapStep / span) * 100).toFixed(0)}% of its range, about ` +
        `${Math.round(wrapStep / typicalStep)}x a typical sample-to-sample step. The DFT treats the ` +
        "record as PERIODIC, so it sees a discontinuity there that is not in your data, and both " +
        "ends of the filtered signal are corrupted by it. Detrend first, or discard the ends."
    );
  }

  if (t <= 0) {
    caveats.push(
      "Brick-wall filter (zero transition width): the passband edge is a cliff, which is a " +
        "sinc in the time domain. Expect RINGING either side of every sharp feature — and " +
        "that ringing looks exactly like real structure in the data. Use a transition band."
    );
  }

  if (N !== n) {
    caveats.push(
      `Zero-padded from ${n} to ${N} samples for the radix-2 transform, so the frequency ` +
        `resolution is ${binWidth.toPrecision(3)} Hz per bin rather than ${(sampleRate / n).toPrecision(3)}. ` +
        "The padding also adds its own edge at the end of the real data."
    );
  }

  caveats.push(
    "Frequency-domain filtering is not causal and has no phase distortion — unlike a real " +
      "analogue filter. That is usually what you want for post-hoc analysis, but it means " +
      "this does NOT model what an instrument's own filter did to the signal."
  );

  return { signal: out, kind, paddedLength: N, binWidth, caveats };
}
