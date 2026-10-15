// Adversarial pass over the v2.140.0 audio + loudness engines: degenerate and
// hostile inputs, extreme frequencies, impossible crossovers, the display
// contract in every note, and a 4-second bound on every list at its cap.
import {
  levelConvert,
  levelSum,
  levelSubtract,
  levelAverage,
  coherentSum,
  weighting,
  bandsToWeighted,
  ditherBudget,
  audioSize,
  speakerSpl,
  speedOfSound,
  absorptionBudget,
  passiveCrossover,
  crossoverResponseDb,
  cableDamping,
  reverbTime,
  toDb,
  parseBandList,
  parseLevelList,
  parseSurfaceList,
  MAX_LIST,
  AudioFigure,
  LevelRef,
} from "../audio";
import { kWeightGainDb, sineLoudness, gatedIntegrated, normaliseGain, combineChannels, MAX_BLOCKS } from "../loudness";

type AnyResult = { ok: boolean; error?: string; notes?: string[]; figure?: AudioFigure };

const refused = (r: unknown): string => {
  const x = r as AnyResult;
  expect(x.ok).toBe(false);
  expect(typeof x.error).toBe("string");
  expect(x.error!.length).toBeGreaterThan(10);
  return x.error!;
};

const BAD_TEXT = /NaN|Infinity|undefined|\bnull\b|\bm\^2\b|\bm\^3\b|\[object/;
/** Float noise echoed back: 4.998720000000001 or 0.30000000000000004. */
const LONG_DIGITS = /\d[.,]?\d{11,}/;

function checkClean(r: unknown): void {
  const x = r as AnyResult;
  if (!x.ok) {
    expect(x.error).not.toMatch(BAD_TEXT);
    return;
  }
  for (const n of x.notes ?? []) {
    expect(n).not.toMatch(BAD_TEXT);
    expect(n).not.toMatch(LONG_DIGITS);
  }
  if (x.figure) {
    const f = x.figure;
    const labels = [
      f.title,
      f.note ?? "",
      ...(f.series ?? []).map((s) => s.label),
      ...(f.bars ?? []).map((b) => b.label),
      ...(f.markers ?? []).map((m) => m.label),
      ...(f.ladder ?? []).flatMap((l) => [l.name, ...l.ticks.map((t) => t.label)]),
    ];
    for (const l of labels) {
      expect(l).not.toMatch(BAD_TEXT);
      expect(l).not.toMatch(/\^/);
      expect(l).not.toMatch(LONG_DIGITS);
      expect(l).not.toMatch(/\de[+-]?\d/);
    }
    for (const s of f.series ?? []) for (const p of s.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    for (const b of f.bars ?? []) expect(Number.isFinite(b.value)).toBe(true);
    for (const m of f.markers ?? []) expect(Number.isFinite(m.at)).toBe(true);
    for (const l of f.ladder ?? []) {
      expect(l.ticks.length).toBeLessThanOrEqual(200);
      for (const t of l.ticks) expect(Number.isFinite(t.at)).toBe(true);
    }
  }
}

function within4s<T>(fn: () => T): T {
  const t0 = Date.now();
  const r = fn();
  expect(Date.now() - t0).toBeLessThan(4000);
  return r;
}

describe("dB of zero or negative quantities is refused", () => {
  it.each([
    [0, "Vrms"],
    [-1, "Vrms"],
    [0, "Pa"],
    [-20e-6, "Pa"],
    [0, "W"],
    [-1, "W"],
    [0, "mVPa"],
    [-10, "mVPa"],
  ] as [number, LevelRef][])("%f %s", (v, ref) => {
    expect(refused(levelConvert(v, ref, ref))).toMatch(/greater than zero/);
  });

  it("non-finite values, unknown references and toDb(0)", () => {
    for (const v of [NaN, Infinity, -Infinity]) refused(levelConvert(v, "dBu", "dBV"));
    refused(levelConvert(1, "dBX" as LevelRef, "dBu"));
    refused(toDb(0, "power"));
  });

  it("levels that overflow or underflow a double are refused, not returned as 0 or ∞", () => {
    expect(refused(levelConvert(1e6, "dBu", "Vrms"))).toMatch(/range/);
    expect(refused(levelConvert(-1e6, "dBSPL", "Pa"))).toMatch(/range/);
    // a subnormal voltage is still > 0: a (very) negative level, finite, not a crash
    const sub = levelConvert(1e-320, "Vrms", "dBu");
    expect(sub.ok && Number.isFinite(sub.value)).toBe(true);
    checkClean(sub);
  });

  it("dBFS above full scale is refused; +3.01 (a square wave, AES17) is not", () => {
    refused(levelConvert(4, "dBFS", "dBu", { alignment: "ebu-r68" }));
    refused(levelConvert(0.5, "dBFS", "dBu", { alignment: "ebu-r68", convention: "peak" }));
    checkClean(levelConvert(3.0103, "dBFS", "dBu", { alignment: "ebu-r68" }));
    refused(levelConvert(-18, "dBFS", "dBu", { alignment: { dbfs: 6, dbu: 0 } }));
    refused(levelConvert(-18, "dBFS", "dBu", { alignment: "bogus" as never }));
    refused(levelConvert(94, "dBSPL", "dBV", { micSensitivityVPerPa: 0 }));
    refused(levelConvert(94, "dBSPL", "dBV", { micSensitivityVPerPa: -5 }));
    // above 100 V/Pa is no microphone (a mV/Pa figure in the V/Pa slot, ×1000 too big)
    refused(levelConvert(94, "dBSPL", "dBV", { micSensitivityVPerPa: 1000 }));
  });

  it("extreme but valid levels still draw a finite, bounded ladder", () => {
    for (const [v, ref] of [
      [300, "dBu"],
      [-300, "dBV"],
      [1e-12, "Vrms"],
      [1e6, "Vrms"],
      [250, "dBSPL"],
      [-50, "dBSWL"],
      [1e-6, "mVPa"],
    ] as [number, LevelRef][]) {
      const r = levelConvert(v, ref, ref);
      expect(r.ok).toBe(true);
      checkClean(r);
    }
  });
});

describe("level arithmetic edge cases", () => {
  it("empty, non-finite and mismatched lists are refused", () => {
    refused(levelSum([]));
    refused(levelSum([80, NaN]));
    refused(levelSubtract(Infinity, 80));
    refused(levelAverage([80, 70], [1]));
    refused(levelAverage([80, 70], [1, -1]));
    refused(levelAverage([80, 70], [0, 0]));
    refused(coherentSum([80, 80], [0]));
    refused(coherentSum([80], [NaN]));
    refused(coherentSum([80], [1e12]));
  });

  it("a zero duration drops that entry instead of breaking the mean", () => {
    const r = levelAverage([90, 20], [1, 0]);
    expect(r.ok && r.leqDb).toBeCloseTo(90, 12);
  });

  it("huge and widely spread dB values do not overflow the power sum", () => {
    const r = levelSum([1e300, -1e300, 1e300]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totalDb).toBe(1e300);
    const s = levelSum([500, 500]);
    expect(s.ok && s.totalDb).toBeCloseTo(503.0103, 4);
  });

  it("exact cancellation is refused, including three-way at 120° steps", () => {
    expect(refused(coherentSum([80, 80], [0, 180]))).toMatch(/cancel/);
    expect(refused(coherentSum([80, 80, 80], [0, 120, 240]))).toMatch(/cancel/);
    expect(refused(coherentSum([80, 80], [0, -180]))).toMatch(/cancel/);
    // near-cancellation is a real (deep) level, not a refusal
    const r = coherentSum([80, 79.9], [0, 180]);
    expect(r.ok).toBe(true);
    checkClean(r);
  });

  it("subtraction exactly at the 3 dB boundary and a hair under it", () => {
    expect(levelSubtract(83, 80).ok).toBe(true);
    refused(levelSubtract(82.9999999, 80));
  });
});

describe("extreme frequencies", () => {
  it.each([0, -1, NaN, Infinity, 1e-300, 0.5, 1e300, 2e6])("weighting refuses %p Hz", (f) => {
    refused(weighting(f as number, "A"));
  });

  it("weighting at the accepted extremes is finite", () => {
    for (const f of [1, 1e6]) {
      for (const c of ["A", "C", "Z"] as const) {
        const r = weighting(f, c);
        expect(r.ok).toBe(true);
        if (r.ok) expect(Number.isFinite(r.db)).toBe(true);
        checkClean(r);
      }
    }
    refused(weighting(1000, "B" as never));
  });

  it("the K-filter refuses DC, sub-1 Hz, Nyquist and above, other rates", () => {
    for (const f of [0, -5, 0.5, 1e-300, 24000, 1e9, NaN]) refused(kWeightGainDb(f));
    refused(kWeightGainDb(997, 96000));
    refused(sineLoudness(0, 997, "L", 44100));
    const near = kWeightGainDb(23999.999);
    expect(near.ok).toBe(true);
    checkClean(near);
  });

  it("band lists reject garbage and bands with unreadable entries", () => {
    for (const t of ["", "  ", "1kk", "abc", "63,,x", "−63", "0", "63 Hz 0"]) {
      expect([t, parseBandList(t).ok]).toEqual([t, false]);
    }
    const r = bandsToWeighted([0, 1000], [80, 80]);
    refused(r);
    refused(bandsToWeighted([1000], [80, 80]));
  });
});

describe("crossovers with impossible components", () => {
  it.each([
    [0, 8, "lr2"],
    [-2500, 8, "lr2"],
    [NaN, 8, "lr2"],
    [10, 8, "lr2"],
    [1e9, 8, "lr2"],
    [2500, 0, "lr2"],
    [2500, -8, "lr2"],
    [2500, 0.1, "lr2"],
    [2500, 1e6, "lr2"],
    [2500, 8, "bogus"],
    [2500, 8, "lr4"],
    [2500, 8, "3rd"],
  ] as [number, number, string][])("fc %p, R %p, %s is refused", (fc, r, t) => {
    refused(passiveCrossover(fc, r, t));
  });

  it("buildable-but-absurd values carry the impractical warning", () => {
    const r = passiveCrossover(20, 1, "1st");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.capacitanceF).toBeGreaterThan(1e-3);
      expect(r.notes.join(" ")).toMatch(/impractically large/);
    }
    checkClean(r);
  });

  it("the band edges compute and draw cleanly for every type", () => {
    for (const fc of [20, 20000]) {
      for (const t of ["1st", "bw2", "lr2"] as const) {
        const r = passiveCrossover(fc, 8, t);
        expect(r.ok).toBe(true);
        checkClean(r);
        const v = crossoverResponseDb(fc, t, fc, "lp");
        expect(typeof v).toBe("number");
      }
    }
    refused(crossoverResponseDb(0, "bw2", 1000, "lp") as never);
  });
});

describe("other tools' hostile inputs", () => {
  it("dither", () => {
    for (const b of [0, 1.5, 65, NaN]) refused(ditherBudget(b, "tpdf"));
    refused(ditherBudget(16, "tpdf", 0.5));
    refused(ditherBudget(16, "tpdf", NaN));
    refused(ditherBudget(16, "tpdf", 1, 1));
    refused(ditherBudget(16, "gaussian" as never));
  });

  it("file size", () => {
    refused(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 2 }));
    refused(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 2, durationS: 1, sizeBytes: 1 }));
    refused(audioSize({ mode: "pcm", fs: 0, bits: 24, channels: 2, durationS: 1 }));
    refused(audioSize({ mode: "pcm", fs: 48000, bits: 0, channels: 2, durationS: 1 }));
    refused(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 0, durationS: 1 }));
    refused(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 2, durationS: 1e20 }));
    refused(audioSize({ mode: "compressed", bitRate: 1, sizeBytes: 1e18 }));
    refused(audioSize({ mode: "compressed", bitRate: -320000, durationS: 1 }));
    refused(audioSize({ mode: "mp3" as never, durationS: 1 }));
    // 20-bit in 3-byte containers: the WAV ceiling uses the container
    const r = audioSize({ mode: "pcm", fs: 48000, bits: 20, channels: 2, durationS: 60 });
    expect(r.ok && r.wavMaxSeconds).toBeCloseTo(4294967259 / 288000, 6);
    checkClean(r);
  });

  it("loudspeaker", () => {
    const base = { sensitivityDb: 88, basis: "1W" as const, impedanceOhm: 8, powerW: 100, distanceM: 4 };
    refused(speakerSpl({ ...base, distanceM: 0 }));
    refused(speakerSpl({ ...base, powerW: 0 }));
    refused(speakerSpl({ ...base, powerW: -100 }));
    refused(speakerSpl({ ...base, impedanceOhm: 0 }));
    refused(speakerSpl({ ...base, sensitivityDb: NaN }));
    refused(speakerSpl({ ...base, boxes: 1.5 }));
    refused(speakerSpl({ ...base, crestDb: -3 }));
    refused(speakerSpl({ ...base, basis: "1V" as never }));
    refused(speakerSpl({ ...base, targetSplDb: NaN }));
    refused(speakerSpl({ ...base, targetSplDb: 1e6 }));
    checkClean(speakerSpl({ ...base, distanceM: 1e4, boxes: 1000, coherent: true, crestDb: 40, targetSplDb: 150 }));
    refused(speedOfSound(-300));
    refused(speedOfSound(0));
    refused(speedOfSound(20)); // 20 K: a °C number in the kelvin slot is refused, not computed
    refused(speedOfSound(293.15, 0));
  });

  it("reverb Q", () => {
    for (const q of [0, -1, NaN, Infinity, 1e6]) refused(reverbTime(200, 240, 0.2, q));
  });

  it("absorption", () => {
    refused(absorptionBudget(200, [{ area: 60, alpha: 1 }]));
    refused(absorptionBudget(200, [{ area: 60, alpha: -0.1 }]));
    refused(absorptionBudget(200, [{ area: 60, alpha: 0 }]));
    refused(absorptionBudget(200, [{ area: 0, alpha: 0.5 }]));
    refused(absorptionBudget(200, []));
    refused(absorptionBudget(0, [{ area: 60, alpha: 0.5 }]));
    refused(absorptionBudget(200, [{ area: 60, alpha: 0.5 }], -0.01));
    // air absorption alone already below the target time
    expect(refused(absorptionBudget(200, [{ area: 60, alpha: 0.5 }], 0.5, 10))).toMatch(/Air absorption alone/);
    expect(parseSurfaceList("60 / 0.02").ok).toBe(false);
    expect(parseSurfaceList("60, 0.02, 9").ok).toBe(false);
  });

  it("cable", () => {
    refused(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10 }));
    refused(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, areaM2: 2.5e-6, awg: 12 }));
    refused(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, awg: 41 }));
    refused(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, awg: 12.5 }));
    refused(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, areaM2: 0 }));
    refused(cableDamping({ loadOhm: 8, sourceOhm: -0.02, lengthM: 10, areaM2: 2.5e-6 }));
    refused(cableDamping({ loadOhm: 0, sourceOhm: 0.02, lengthM: 10, areaM2: 2.5e-6 }));
    // a bare 2.5 (read as m²) and a mm² value passed as m² twice over are refused by name
    expect(refused(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, areaM2: 2.5 }))).toMatch(/busbar/);
    expect(refused(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, areaM2: 2.5e-12 }))).toMatch(/thinner/);
    checkClean(cableDamping({ loadOhm: 8, sourceOhm: 0, lengthM: 1000, awg: -3 }));
  });

  it("loudness", () => {
    refused(normaliseGain(-80, -23));
    refused(normaliseGain(-16, NaN));
    refused(normaliseGain(-16, 5));
    refused(normaliseGain(-16, -23, NaN));
    refused(gatedIntegrated([]));
    refused(gatedIntegrated([NaN]));
    refused(gatedIntegrated([-71, -90]));
    refused(combineChannels([{ channel: "X", lufs: -23 }]));
    refused(combineChannels([{ channel: "LFE", lufs: -23 }]));
    refused(sineLoudness(0, 997, "7.1.4"));
  });
});

describe("display contract: unit-converted inputs echo without float noise (E9)", () => {
  const ft = 16.4 * 0.3048; // 4.998720000000001
  const tenth = 0.1 + 0.2; // 0.30000000000000004
  it.each([
    ["levelConvert", () => levelConvert(94, "dBSPL", "dBV", { micSensitivityVPerPa: tenth / 30 })],
    ["levelConvert dBFS", () => levelConvert(tenth - 1, "dBFS", "dBu", { alignment: "ebu-r68" })],
    ["levelConvert dBFS refusal", () => levelConvert(tenth + 4, "dBFS", "dBu", { alignment: "ebu-r68" })],
    ["levelSum", () => levelSum([80 + tenth, 74])],
    ["levelSubtract refusal", () => levelSubtract(80, 80 + tenth)],
    ["levelAverage", () => levelAverage([70 + tenth, 80], [ft, 1])],
    ["coherentSum", () => coherentSum([80, 80 + tenth], [0, 90 + tenth])],
    ["weighting", () => weighting(31.5 + tenth * 1e-9, "A")],
    ["weighting refusal", () => weighting(ft * 1e6, "A")],
    ["bands", () => bandsToWeighted([63 + tenth * 1e-9, 1000], [80, 80])],
    ["dither", () => ditherBudget(16, "tpdf", 4 + tenth, -tenth)],
    ["size", () => audioSize({ mode: "pcm", fs: 48000 * (1 + tenth * 1e-9), bits: 24, channels: 2, durationS: 3600 * ft })],
    ["speaker", () => speakerSpl({ sensitivityDb: 88, basis: "2.83V", impedanceOhm: 8 * (1 + tenth * 1e-9), powerW: 100 + tenth, distanceM: ft, crestDb: 12 + tenth, targetSplDb: 100 })],
    ["speed", () => speedOfSound(293.15 + tenth, 1000)],
    ["absorption", () => absorptionBudget(200, [{ area: ft * 12, alpha: tenth }], 0.0024, 0.5 + tenth)],
    ["crossover", () => passiveCrossover(2500 + tenth, 8 + tenth, "lr2")],
    ["crossover refusal", () => passiveCrossover(20000 + tenth, 8, "lr2")],
    ["cable", () => cableDamping({ loadOhm: 8 + tenth, sourceOhm: tenth / 10, lengthM: ft * 2, areaM2: 2.5e-6 })],
    ["reverb", () => reverbTime(200, 240, 0.2, 2 + tenth)],
    ["normalise", () => normaliseGain(-16 - tenth, -23, -1 + tenth)],
    ["sine", () => sineLoudness(-tenth, 997 + tenth, "5.1")],
    ["k refusal", () => kWeightGainDb(24000 + tenth)],
  ] as [string, () => unknown][])("%s", (_n, fn) => {
    checkClean(fn());
  });

  it("the default ladders label decades as 10⁻⁴ Pa, never 10^-4", () => {
    const r = levelConvert(94, "dBSPL", "Pa");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const labels = r.figure.ladder!.flatMap((l) => l.ticks.map((t) => t.label));
      expect(labels).toContain("10⁻⁴ Pa");
      checkClean(r);
    }
    checkClean(levelConvert(1, "W", "dBSWL"));
  });
});

describe("4-second bounds at every cap", () => {
  const levels = Array.from({ length: MAX_LIST }, (_, i) => 40 + (i % 50));
  it("level lists at MAX_LIST, and MAX_LIST + 1 refused", () => {
    within4s(() => expect(levelSum(levels).ok).toBe(true));
    within4s(() => expect(levelAverage(levels, levels.map(() => 1)).ok).toBe(true));
    within4s(() => expect(coherentSum(levels, levels.map((_, i) => i * 7)).ok).toBe(true));
    refused(levelSum([...levels, 80]));
  });

  it("parsers on long and pathological text", () => {
    within4s(() => expect(parseLevelList(levels.join(", ")).ok).toBe(true));
    within4s(() => parseLevelList("1".repeat(200000) + "x"));
    within4s(() => parseBandList("1".repeat(200000) + "kk"));
    within4s(() => parseSurfaceList("60, 0.02 / ".repeat(5000)));
    within4s(() => parseLevelList("8".repeat(100000) + "e" + "-".repeat(100000)));
  });

  it("200 bands, 200 surfaces, MAX_BLOCKS gated blocks", () => {
    const f = Array.from({ length: 200 }, (_, i) => 10 + i * 50);
    within4s(() => expect(bandsToWeighted(f, f.map(() => 80)).ok).toBe(true));
    const s = Array.from({ length: 200 }, (_, i) => ({ area: 1 + i, alpha: 0.1 + (i % 8) / 10 }));
    within4s(() => expect(absorptionBudget(1000, s, 0.001, 1).ok).toBe(true));
    const blocks = Array.from({ length: MAX_BLOCKS }, (_, i) => -30 + (i % 20));
    within4s(() => expect(gatedIntegrated(blocks).ok).toBe(true));
    refused(gatedIntegrated([...blocks, -20]));
  });
});
