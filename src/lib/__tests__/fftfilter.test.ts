// FFT filtering — checked by whether it actually removes the frequency it claims to.
//
// WHY THIS EXISTS (punch list #18)
// fft.ts had the transforms but no filtering, which is what people actually want an
// FFT for: strip the 50 Hz mains hum, drop the high-frequency noise, keep the band
// of interest.
//
// The risk is that both classic artefacts produce output that is SMOOTH, PLAUSIBLE
// AND WRONG:
//   * Gibbs ringing from a brick-wall cutoff invents oscillations around every edge,
//     and they look exactly like real features.
//   * Circular wraparound: the DFT assumes periodicity, so a signal whose ends do
//     not match gets both ends corrupted by a discontinuity that is not in the data.
// Neither crashes. So these tests check the filter against signals whose correct
// answer is known by construction, rather than eyeballing a smooth curve.

import { fftFilter } from "../fftfilter";
import { spectrum } from "../fft";

const SR = 200; // Hz
const N = 512;

/** A sine of amplitude a at frequency f, sampled at SR. */
const sine = (f: number, a = 1, n = N) =>
  Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR));

const add = (...xs: number[][]) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0));

/** Amplitude present near frequency f, read back off the spectrum. */
function amplitudeAt(sig: number[], f: number): number {
  const bins = spectrum(sig, SR);
  let best = 0;
  for (const b of bins) if (Math.abs(b.freq - f) < 2) best = Math.max(best, b.magnitude);
  return best;
}

describe("it removes what it says it removes, and keeps what it says it keeps", () => {
  test("low-pass keeps 5 Hz and kills 60 Hz", () => {
    const sig = add(sine(5), sine(60));
    const r = fftFilter(sig, SR, "lowpass", { cutoff: 20 })!;
    expect(r).not.toBeNull();
    expect(amplitudeAt(r.signal, 5)).toBeGreaterThan(0.8 * amplitudeAt(sig, 5));
    expect(amplitudeAt(r.signal, 60)).toBeLessThan(0.02 * amplitudeAt(sig, 60));
  });

  test("high-pass does the opposite", () => {
    const sig = add(sine(5), sine(60));
    const r = fftFilter(sig, SR, "highpass", { cutoff: 20 })!;
    expect(amplitudeAt(r.signal, 60)).toBeGreaterThan(0.8 * amplitudeAt(sig, 60));
    expect(amplitudeAt(r.signal, 5)).toBeLessThan(0.02 * amplitudeAt(sig, 5));
  });

  test("band-pass keeps only the middle component", () => {
    const sig = add(sine(3), sine(30), sine(80));
    const r = fftFilter(sig, SR, "bandpass", { cutoff: 20, cutoffHigh: 45 })!;
    expect(amplitudeAt(r.signal, 30)).toBeGreaterThan(0.8 * amplitudeAt(sig, 30));
    expect(amplitudeAt(r.signal, 3)).toBeLessThan(0.05 * amplitudeAt(sig, 3));
    expect(amplitudeAt(r.signal, 80)).toBeLessThan(0.05 * amplitudeAt(sig, 80));
  });

  test("band-stop notches out mains hum and leaves the rest alone", () => {
    // The single most common real use: kill 50 Hz, keep the signal.
    const sig = add(sine(8, 1), sine(50, 3), sine(90, 1));
    const r = fftFilter(sig, SR, "bandstop", { cutoff: 45, cutoffHigh: 55 })!;
    expect(amplitudeAt(r.signal, 50)).toBeLessThan(0.05 * amplitudeAt(sig, 50));
    expect(amplitudeAt(r.signal, 8)).toBeGreaterThan(0.8 * amplitudeAt(sig, 8));
    expect(amplitudeAt(r.signal, 90)).toBeGreaterThan(0.8 * amplitudeAt(sig, 90));
  });

  test("the output is REAL — negative-frequency bins got the same gain", () => {
    // If the mirrored bins are filtered differently the inverse transform is
    // complex, and taking .re silently discards half the answer.
    const sig = add(sine(5), sine(60));
    const r = fftFilter(sig, SR, "lowpass", { cutoff: 20 })!;
    for (const v of r.signal) expect(Number.isFinite(v)).toBe(true);
    // A pure 5 Hz sine should survive a 20 Hz low-pass essentially intact.
    const pure = sine(5);
    const kept = fftFilter(pure, SR, "lowpass", { cutoff: 20 })!;
    for (let i = 10; i < N - 10; i++) expect(Math.abs(kept.signal[i] - pure[i])).toBeLessThan(0.05);
  });

  test("a pass-everything filter is the identity", () => {
    // The strongest round-trip: gain 1 at EVERY bin must return the input exactly,
    // so the FFT/IFFT pair and the bin mapping are both right.
    //
    // The cutoff must sit ABOVE Nyquist (100 Hz), not just near it. An earlier draft
    // used 99 and failed by 0.006 — because bins between 99 and 100 were still being
    // zeroed, and sine(11) is 28.16 cycles in this window, so spectral leakage puts
    // real energy up there. That was the test being wrong, not the filter.
    const sig = add(sine(5), sine(60), sine(11, 0.3));
    const r = fftFilter(sig, SR, "lowpass", { cutoff: 200, transition: 0 })!;
    for (let i = 0; i < N; i++) expect(r.signal[i]).toBeCloseTo(sig[i], 6);
  });
});

describe("the transition band is what stops it ringing", () => {
  test("a brick wall rings on a step; a smooth transition rings far less", () => {
    // Gibbs, demonstrated rather than asserted. A step filtered with a cliff comes
    // back with oscillations that look like real features.
    const step = Array.from({ length: N }, (_, i) => (i < N / 2 ? 0 : 1));
    const brick = fftFilter(step, SR, "lowpass", { cutoff: 10, transition: 0 })!;
    const smooth = fftFilter(step, SR, "lowpass", { cutoff: 10, transition: 8 })!;

    // Overshoot measured well away from the edge, where the signal should be flat.
    const overshoot = (s: number[]) => {
      let m = 0;
      for (let i = 20; i < N / 2 - 20; i++) m = Math.max(m, Math.abs(s[i] - 0));
      return m;
    };
    expect(overshoot(brick.signal)).toBeGreaterThan(overshoot(smooth.signal));
  });

  test("a brick wall SAYS it will ring", () => {
    const r = fftFilter(sine(5), SR, "lowpass", { cutoff: 20, transition: 0 })!;
    expect(r.caveats.join(" ")).toMatch(/RINGING/);
    expect(r.caveats.join(" ")).toMatch(/looks exactly like real structure/);
  });

  test("the default transition is non-zero — you get the safe behaviour unasked", () => {
    const r = fftFilter(sine(5), SR, "lowpass", { cutoff: 20 })!;
    expect(r.caveats.join(" ")).not.toMatch(/Brick-wall/);
  });
});

describe("the artefacts that do not announce themselves are announced", () => {
  test("a signal whose ends do not match is warned about", () => {
    // A ramp: starts at 0, ends at 10. The DFT sees a cliff between the last and
    // first sample that exists nowhere in the data, and corrupts both ends.
    const ramp = Array.from({ length: N }, (_, i) => (i / N) * 10);
    const r = fftFilter(ramp, SR, "lowpass", { cutoff: 20 })!;
    expect(r.caveats.join(" ")).toMatch(/treats the record as PERIODIC/);
    expect(r.caveats.join(" ")).toMatch(/Detrend first/);
  });

  test("a signal whose ends match is NOT warned — or the warning is noise", () => {
    // An exact whole number of cycles, so the record really IS periodic and there is
    // no discontinuity to warn about.
    //
    // 12.5 Hz, not 5: a whole number of cycles needs f*N/SR to be an integer, and
    // 5*512/200 = 12.8 is not. An earlier draft used 5 Hz, "failed", and was right to
    // — that signal ends at -0.99 having started at 0, which is exactly the
    // wraparound the caveat exists to flag. My comment was wrong, not the code.
    const cycles = (12.5 * 512) / SR;
    expect(Number.isInteger(cycles)).toBe(true); // guard the premise of this test
    const r = fftFilter(sine(12.5, 1, 512), SR, "lowpass", { cutoff: 20 })!;
    expect(r.caveats.join(" ")).not.toMatch(/treats the record as PERIODIC/);
  });

  test("a cutoff above Nyquist is called out, including the aliasing consequence", () => {
    const r = fftFilter(sine(5), SR, "lowpass", { cutoff: 150 })!;
    expect(r.caveats.join(" ")).toMatch(/at or above the Nyquist frequency/);
    expect(r.caveats.join(" ")).toMatch(/ALIASED down/);
  });

  test("zero-padding changes the bin width and says so", () => {
    const r = fftFilter(sine(5, 1, 300), SR, "lowpass", { cutoff: 20 })!;
    expect(r.paddedLength).toBe(512);
    expect(r.caveats.join(" ")).toMatch(/Zero-padded from 300 to 512/);
    expect(r.binWidth).toBeCloseTo(SR / 512, 9);
  });

  test("every result states that this is not a causal filter", () => {
    const r = fftFilter(sine(5), SR, "lowpass", { cutoff: 20 })!;
    expect(r.caveats.join(" ")).toMatch(/not causal/);
    expect(r.caveats.join(" ")).toMatch(/does NOT model what an instrument's own filter did/);
  });
});

describe("it refuses rather than returning something filtered-looking", () => {
  test("too few samples returns null", () => {
    expect(fftFilter([1, 2], SR, "lowpass", { cutoff: 10 })).toBeNull();
  });

  test("a non-positive sample rate or cutoff returns null", () => {
    expect(fftFilter(sine(5), 0, "lowpass", { cutoff: 10 })).toBeNull();
    expect(fftFilter(sine(5), SR, "lowpass", { cutoff: 0 })).toBeNull();
  });

  test("a band with its edges the wrong way round returns null", () => {
    // High <= low is not a band. Silently swapping them would be guessing at intent.
    expect(fftFilter(sine(5), SR, "bandpass", { cutoff: 50, cutoffHigh: 20 })).toBeNull();
    expect(fftFilter(sine(5), SR, "bandstop", { cutoff: 50, cutoffHigh: 50 })).toBeNull();
  });
});
