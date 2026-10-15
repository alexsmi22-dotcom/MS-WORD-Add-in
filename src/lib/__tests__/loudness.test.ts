// ITU-R BS.1770-4 loudness — §D1 rows from docs/SCOPE-AUDIO-VIDEO-2026-10.md.
// [L] values were re-derived this session with scipy 1.18.1 `freqz` on the
// published biquads and pyloudnorm 0.2.0 with filter_class="DeMan" (its
// DEFAULT filter is 0.04 dB off the standard and must not be the oracle).
import {
  K_STAGE1,
  K_STAGE2,
  kGainDb,
  kWeightGainDb,
  sineLoudness,
  combineChannels,
  gatedIntegrated,
  normaliseGain,
  programmeLoudnessFromReading,
  PROGRAMME_LOUDNESS_REFUSAL,
  LOUDNESS_TARGETS,
  CHANNEL_WEIGHTS,
} from "../loudness";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};
const refused = (r: { ok: boolean }): string => {
  expect(r.ok).toBe(false);
  return (r as unknown as { error: string }).error;
};

describe("K-weighting filter (BS.1770-4 Tables 1 and 2, 48 kHz)", () => {
  it("[P] the published coefficients; stage 2's numerator is exactly 1, −2, 1 (pyloudnorm's default is not)", () => {
    expect(K_STAGE1.b).toEqual([1.53512485958697, -2.69169618940638, 1.19839281085285]);
    expect(K_STAGE1.a).toEqual([1.0, -1.69065929318241, 0.73248077421585]);
    expect(K_STAGE2.b).toEqual([1, -2, 1]);
    expect(K_STAGE2.a).toEqual([1.0, -1.99004745483398, 0.99007225036621]);
  });

  it("[L scipy freqz] gain at 997 Hz = +0.6910 dB; 1 kHz +0.6977; 100 Hz −1.1335; 10 kHz +4.0419", () => {
    expect(ok(kWeightGainDb(997)).gainDb).toBeCloseTo(0.691014, 5);
    expect(kGainDb(1000)).toBeCloseTo(0.697704, 5);
    expect(kGainDb(100)).toBeCloseTo(-1.133498, 5);
    expect(kGainDb(10000)).toBeCloseTo(4.041882, 5);
    expect(kGainDb(20)).toBeCloseTo(-13.275368, 4);
  });

  it("refuses other sample rates, DC and anything at or above Nyquist, by name", () => {
    expect(refused(kWeightGainDb(997, 44100))).toMatch(/BS\.1770 publishes 48 kHz coefficients/);
    expect(refused(kWeightGainDb(0))).toMatch(/DC/);
    expect(refused(kWeightGainDb(24000))).toMatch(/Nyquist/);
    expect(refused(kWeightGainDb(30000))).toMatch(/Nyquist/);
  });
});

describe("steady-sine loudness", () => {
  it("[P]+[L] 997 Hz, 0 dBFS: one front channel −3.0103 LUFS; two 0.0000", () => {
    const one = ok(sineLoudness(0, 997, "L"));
    expect(one.loudnessLufs).toBeCloseTo(-3.0103, 3);
    // pyloudnorm DeMan on 10 s of the sine: −3.010280 / +0.000020
    expect(Math.abs(one.loudnessLufs - -3.01028)).toBeLessThan(1e-4);
    const two = ok(sineLoudness(0, 997, "L+R"));
    expect(Math.abs(two.loudnessLufs)).toBeLessThan(1e-4);
    expect(two.loudnessLufs - one.loudnessLufs).toBeCloseTo(10 * Math.log10(2), 12);
    expect(one.figure.series![0].points.length).toBeGreaterThan(10);
  });

  it("[L] 1000 Hz gives −3.0036 — not interchangeable with 997", () => {
    expect(ok(sineLoudness(0, 1000, "L")).loudnessLufs).toBeCloseTo(-3.0036, 4);
  });

  it("[L] 100 Hz / 10 kHz one channel: −4.8348 / +0.3406 (pyloudnorm DeMan −4.8351 / +0.3406; its default −4.873 / +0.297)", () => {
    expect(ok(sineLoudness(0, 100, "L")).loudnessLufs).toBeCloseTo(-4.8348, 4);
    expect(ok(sineLoudness(0, 10000, "L")).loudnessLufs).toBeCloseTo(0.3406, 4);
  });

  it("5.1: surrounds weigh 1.41, LFE is excluded and said", () => {
    const r = ok(sineLoudness(0, 997, "5.1"));
    expect(r.weightSum).toBeCloseTo(3 + 2 * 1.41, 12);
    expect(r.loudnessLufs).toBeCloseTo(-3.0103 + 10 * Math.log10(5.82), 3);
    expect(r.notes.join(" ")).toMatch(/LFE is EXCLUDED/);
    expect(CHANNEL_WEIGHTS.LFE).toBe(0);
    expect(refused(sineLoudness(0, 997, ["LFE"]))).toMatch(/excludes LFE/);
  });

  it("amplitude scales dB for dB; a sine under the −70 gate has no loudness", () => {
    expect(ok(sineLoudness(-20, 997, "L")).loudnessLufs).toBeCloseTo(-23.0103, 3);
    expect(refused(sineLoudness(-68, 997, "L"))).toMatch(/absolute gate/);
    expect(refused(sineLoudness(1, 997, "L"))).toMatch(/full scale/);
  });
});

describe("channel combination", () => {
  it("L and R each −23 → −19.99; Ls weighs 1.41", () => {
    expect(
      ok(combineChannels([
        { channel: "L", lufs: -23 },
        { channel: "R", lufs: -23 },
      ])).loudnessLufs,
    ).toBeCloseTo(-23 + 10 * Math.log10(2), 12);
    expect(ok(combineChannels([{ channel: "Ls", lufs: -23 }])).loudnessLufs).toBeCloseTo(-23 + 10 * Math.log10(1.41), 12);
    expect(
      ok(combineChannels([
        { channel: "L", lufs: -23 },
        { channel: "LFE", lufs: 0 },
      ])).loudnessLufs,
    ).toBeCloseTo(-23, 12);
  });
});

describe("gating on typed block loudnesses (T2)", () => {
  it("[F] two-stage gate matches a numpy re-implementation", () => {
    // numpy: [-23, -23, -20, -40, -80, -25] → -22.368337 (relative gate -33.318747)
    const r = ok(gatedIntegrated([-23, -23, -20, -40, -80, -25]));
    expect(r.integratedLufs).toBeCloseTo(-22.368337, 5);
    expect(r.relativeGateLufs).toBeCloseTo(-33.318747, 5);
    expect(r.passedAbsolute).toBe(5);
    expect(r.passedBoth).toBe(4);
    const r2 = ok(gatedIntegrated([-30, -20, -21, -35, -69.9, -75]));
    expect(r2.integratedLufs).toBeCloseTo(-21.99666, 5);
  });

  it("[X] a constant programme integrates to itself", () => {
    expect(ok(gatedIntegrated(new Array(100).fill(-23))).integratedLufs).toBeCloseTo(-23, 12);
  });

  it("the gates are STRICT (l > Γ): a block exactly at −70 is gated out", () => {
    const r = ok(gatedIntegrated([-70, -20]));
    expect(r.passedAbsolute).toBe(1);
    expect(refused(gatedIntegrated([-70, -80]))).toMatch(/absolute gate/);
    // relative gate edge: blocks [0, y] put Γr on y when 10^(y/10) = 1/19
    // (y = −12.7875); a hair above passes, a hair below is gated.
    const y = -10 * Math.log10(19);
    expect(ok(gatedIntegrated([0, y + 1e-6])).passedBoth).toBe(2);
    expect(ok(gatedIntegrated([0, y - 1e-6])).passedBoth).toBe(1);
    expect(ok(gatedIntegrated([0, y])).relativeGateLufs).toBeCloseTo(y, 9);
  });
});

describe("normalisation", () => {
  it("[X] −16.3 → −23 = −6.7 dB", () => {
    const r = ok(normaliseGain(-16.3, -23));
    expect(r.gainDb).toBeCloseTo(-6.7, 12);
    expect(r.offsetLu).toBeCloseTo(6.7, 12);
    expect(r.limiterRequired).toBeNull();
  });

  it("says when a limiter is required, with the resulting true peak", () => {
    const r = ok(normaliseGain(-26.2, -23, -1.8, -1));
    expect(r.gainDb).toBeCloseTo(3.2, 12);
    expect(r.resultingTruePeak!).toBeCloseTo(1.4, 12);
    expect(r.limiterRequired).toBe(true);
    expect(r.notes.join(" ")).toMatch(/\+3\.20 dB of gain would put the true peak at \+1\.40 dBTP/);
    expect(ok(normaliseGain(-16.3, -23, -0.5)).limiterRequired).toBe(false);
  });

  it("only standards are tabulated as targets", () => {
    expect(LOUDNESS_TARGETS.map((t) => t.lufs)).toEqual([-23, -24]);
  });
});

describe("refused by name: programme loudness from a single reading", () => {
  it("integrated / LRA / true peak", () => {
    expect(refused(programmeLoudnessFromReading())).toBe(PROGRAMME_LOUDNESS_REFUSAL);
    expect(PROGRAMME_LOUDNESS_REFUSAL).toMatch(/Integrated loudness requires the programme audio — not computable from typed numbers/);
    expect(refused(programmeLoudnessFromReading("lra"))).toMatch(/not computable from typed numbers/);
    expect(refused(programmeLoudnessFromReading("true-peak"))).toMatch(/oversampled/);
  });
});
