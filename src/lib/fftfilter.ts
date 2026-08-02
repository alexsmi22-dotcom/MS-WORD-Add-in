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
import { minOf, maxOf } from "./minmax";
import { designFilter } from "./filter";

export type FilterKind = "lowpass" | "highpass" | "bandpass" | "bandstop";

/**
 * The shape of the passband edge.
 *
 * `cosine` is the raised-cosine ramp this module has always used: smooth, so it
 * does not ring, but it is an ad-hoc shape with no stated specification — you
 * cannot say what attenuation it achieves at a given frequency.
 *
 * `butterworth` and `chebyshev` evaluate the magnitude response of a filter
 * DESIGNED to a specification by `filter.ts`, which already computes the
 * minimum order, the poles, and the attenuation actually achieved. The ramp
 * stops being a shape someone chose and becomes the answer to "flat passband,
 * 40 dB down by here" — and the order and true attenuation are reported.
 */
export type FilterResponse = "cosine" | "butterworth" | "chebyshev";

export interface FilterOptions {
  /** Cutoff (Hz) for low/high-pass; the LOW edge for band-pass/stop. */
  cutoff: number;
  /** The HIGH edge (Hz) for band-pass/band-stop. Ignored otherwise. */
  cutoffHigh?: number;
  /**
   * Width of the transition band, in Hz. Default: 10% of the cutoff. Set to 0
   * for a brick wall — which rings. See the module header.
   *
   * For a designed response this is the passband-to-stopband gap: the stopband
   * edge sits this far past the cutoff, and the order follows from it.
   */
  transition?: number;
  /** Edge shape. Defaults to `cosine`, which is what this module always did. */
  response?: FilterResponse;
  /** Stopband attenuation to design for, dB. Designed responses only. Default 40. */
  stopbandDb?: number;
  /** Passband ripple to allow, dB. Chebyshev only. Default 1. */
  passbandDb?: number;
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

/** |H(jω)| for a transfer function given highest-power-first in s. */
function magnitudeAt(num: number[], den: number[], w: number): number {
  // Evaluate a real polynomial at s = jw. Powers of j cycle 1, j, -1, -j, so the
  // real and imaginary parts separate cleanly by the exponent's residue mod 4.
  const at = (p: number[]): { re: number; im: number } => {
    let re = 0;
    let im = 0;
    const deg = p.length - 1;
    for (let i = 0; i < p.length; i++) {
      const power = deg - i;
      const mag = p[i] * Math.pow(w, power);
      switch (power % 4) {
        case 0: re += mag; break;
        case 1: im += mag; break;
        case 2: re -= mag; break;
        default: im -= mag; break;
      }
    }
    return { re, im };
  };
  const nv = at(num);
  const dv = at(den);
  const dm = Math.hypot(dv.re, dv.im);
  if (dm === 0) return 0;
  return Math.hypot(nv.re, nv.im) / dm;
}

/**
 * A gain function built from a filter DESIGNED to a specification.
 *
 * Band-pass and band-stop are composed from a high-pass and a low-pass section,
 * which is how they are built in practice and keeps both edges designed rather
 * than one designed and one improvised. Returns null if the specification
 * cannot be met, so the caller can fall back and say so rather than silently
 * substituting a different filter.
 */
function designedGain(
  kind: FilterKind,
  lo: number,
  hi: number,
  t: number,
  family: "butterworth" | "chebyshev",
  ap: number,
  as: number,
): { gain: (f: number) => number; describe: string } | null {
  const TWO_PI = 2 * Math.PI;
  // A designed filter needs a real gap between passband and stopband; a zero
  // transition would demand infinite order, which is the brick wall again.
  if (!(t > 0)) return null;

  const build = (k: "lowpass" | "highpass", edge: number) => {
    const wp = TWO_PI * (k === "lowpass" ? edge : edge + t / 2);
    const ws = TWO_PI * (k === "lowpass" ? edge + t : Math.max(1e-9, edge - t / 2));
    if (!(wp > 0) || !(ws > 0)) return null;
    const d = designFilter({ family, kind: k, wp, ws, ap, as });
    return d.ok ? d : null;
  };

  switch (kind) {
    case "lowpass":
    case "highpass": {
      const d = build(kind, lo);
      if (!d) return null;
      return {
        gain: (f) => magnitudeAt(d.num, d.den, TWO_PI * f),
        describe: `${family} order ${d.order}, ${d.stopbandAttenuation.toFixed(1)} dB at the stopband edge`,
      };
    }
    case "bandpass": {
      const h = build("highpass", lo);
      const l = build("lowpass", hi);
      if (!h || !l) return null;
      return {
        gain: (f) => magnitudeAt(h.num, h.den, TWO_PI * f) * magnitudeAt(l.num, l.den, TWO_PI * f),
        describe: `${family} order ${h.order} high-pass x order ${l.order} low-pass`,
      };
    }
    case "bandstop": {
      // The complement of the band-pass, built from the same two designed
      // sections so both edges are specified.
      const h = build("highpass", lo);
      const l = build("lowpass", hi);
      if (!h || !l) return null;
      return {
        gain: (f) =>
          1 - magnitudeAt(h.num, h.den, TWO_PI * f) * magnitudeAt(l.num, l.den, TWO_PI * f),
        describe: `${family} order ${h.order} / ${l.order}, complemented`,
      };
    }
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

  // A DESIGNED response, when asked for. The default stays the raised cosine,
  // so nothing that already calls this gets different numbers.
  const wanted = opts.response ?? "cosine";
  let designed: { gain: (f: number) => number; describe: string } | null = null;
  if (wanted !== "cosine") {
    designed = designedGain(
      kind,
      lo,
      hi,
      t,
      wanted,
      opts.passbandDb ?? 1,
      opts.stopbandDb ?? 40,
    );
    if (!designed) {
      caveats.push(
        `A ${wanted} response could not be designed for this specification, so the raised-cosine ` +
          "edge was used instead. That usually means the transition band is zero or the edges " +
          "are too close together for any finite order. The filter below is the cosine one, " +
          "not the one you asked for.",
      );
    }
  }

  // Transform, scale each bin by the gain at its frequency, transform back.
  const spec = fft(signal);
  for (let k = 0; k < N; k++) {
    // Bins above N/2 are the negative frequencies; they mirror the positive ones
    // and MUST get the same gain or the result is not real-valued.
    const f = (k <= N / 2 ? k : N - k) * binWidth;
    const g = designed ? designed.gain(f) : gainAt(f, kind, lo, hi, t);
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
  const span = maxOf(signal) - minOf(signal);
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

  if (designed) {
    caveats.push(
      `Designed response: ${designed.describe}. The edge is not an arbitrary ramp — the order ` +
        "was computed from your passband and stopband edges, so the attenuation quoted is one " +
        "the filter actually achieves rather than a shape someone picked.",
    );
    caveats.push(
      "The MAGNITUDE response of that design is applied; the phase is not. This stays a " +
        "zero-phase filter, so it does not reproduce what the analogue filter would have done " +
        "to the timing of your signal — only to its amplitudes.",
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
