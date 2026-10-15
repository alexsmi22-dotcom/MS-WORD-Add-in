// v2.140.0 audio deepening — every value from docs/SCOPE-AUDIO-VIDEO-2026-10.md
// §D1 that belongs to audio.ts, with its oracle class beside it.
// [X] exact identity, [P] published table, [L] independent library (scipy
// 1.18.1 / pyloudnorm DeMan, run in a scratchpad venv), [F] formula re-typed
// (NOT independent — always beside an [X] or [P] landmark).
import {
  levelConvert,
  levelSum,
  levelSubtract,
  levelAverage,
  coherentSum,
  distanceFalloff,
  weighting,
  weightingDb,
  exactBandFrequency,
  bandsToWeighted,
  A1000_DB,
  C1000_DB,
  IEC61672_POLES,
  ditherBudget,
  audioSize,
  speakerSpl,
  speedOfSound,
  absorptionBudget,
  passiveCrossover,
  crossoverResponseDb,
  cableDamping,
  awgDiameterMm,
  reverbTime,
  parseBandList,
  parseLevelList,
  parseSurfaceList,
  DBU_TO_DBV,
  PRO_CONSUMER_GAP_DB,
  WAV_MAX_DATA_BYTES,
  COPPER_RHO_OHM_MM2_PER_M,
  AudioFigure,
} from "../audio";
import { designFilter } from "../filter";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};
const list = <T,>(r: { ok: true; values: T[] } | { ok: false; error: string }): T[] => {
  if (!r.ok) throw new Error(r.error);
  return r.values;
};
const refused = (r: { ok: boolean }): string => {
  expect(r.ok).toBe(false);
  return (r as unknown as { error: string }).error;
};

/** Every figure: finite numbers only, bounded size. */
function checkFigure(f: AudioFigure): void {
  const nums: number[] = [];
  for (const s of f.series ?? []) {
    expect(s.points.length).toBeLessThanOrEqual(2000);
    for (const p of s.points) nums.push(p.x, p.y);
  }
  for (const b of f.bars ?? []) nums.push(b.value);
  for (const m of f.markers ?? []) nums.push(m.at);
  for (const l of f.ladder ?? []) for (const t of l.ticks) nums.push(t.at);
  for (const n of nums) expect(Number.isFinite(n)).toBe(true);
  expect(nums.length).toBeGreaterThan(0);
}

describe("§D1 levels and references", () => {
  it("[X] 0 dBu = √0.6 V = 0.7745966692 V", () => {
    const r = ok(levelConvert(0, "dBu", "Vrms"));
    expect(r.value).toBeCloseTo(0.7745966692, 9);
    expect(r.value).toBeCloseTo(Math.sqrt(0.6), 14);
  });

  it("[X] +4 dBu = 1.2276530 V = +1.7815 dBV; gap to −10 dBV 11.7815; offset −2.2185", () => {
    const r = ok(levelConvert(4, "dBu", "dBV"));
    expect(r.all.Vrms!).toBeCloseTo(1.227653, 6);
    expect(r.value).toBeCloseTo(1.7815, 4);
    expect(r.value - -10).toBeCloseTo(11.7815, 4);
    expect(PRO_CONSUMER_GAP_DB).toBeCloseTo(11.7815, 4);
    expect(DBU_TO_DBV).toBeCloseTo(-2.2185, 4);
    expect(r.proConsumerGapDb).toBeCloseTo(11.7815, 4);
  });

  it("[X] dBm (600 Ω) equals dBu numerically and the note says why", () => {
    const r = ok(levelConvert(4, "dBm600", "dBu"));
    expect(r.value).toBeCloseTo(4, 12);
    expect(r.notes.join(" ")).toMatch(/600 Ω/);
  });

  it("[P] 0 dBFS = +18 dBu (EBU R68) / +24 dBu (SMPTE RP 155)", () => {
    expect(ok(levelConvert(0, "dBFS", "dBu", { alignment: "ebu-r68" })).value).toBeCloseTo(18, 9);
    expect(ok(levelConvert(0, "dBFS", "dBu", { alignment: "smpte-rp155" })).value).toBeCloseTo(24, 9);
    // the defining points themselves
    expect(ok(levelConvert(-18, "dBFS", "dBu", { alignment: "ebu-r68" })).value).toBeCloseTo(0, 9);
    expect(ok(levelConvert(-20, "dBFS", "dBu", { alignment: "smpte-rp155" })).value).toBeCloseTo(4, 9);
  });

  it("[X] −10 dBFS → +8 / +14 dBu; +4 dBu → −14 / −20 dBFS", () => {
    expect(ok(levelConvert(-10, "dBFS", "dBu", { alignment: "ebu-r68" })).value).toBeCloseTo(8, 9);
    expect(ok(levelConvert(-10, "dBFS", "dBu", { alignment: "smpte-rp155" })).value).toBeCloseTo(14, 9);
    expect(ok(levelConvert(4, "dBu", "dBFS", { alignment: "ebu-r68" })).value).toBeCloseTo(-14, 9);
    expect(ok(levelConvert(4, "dBu", "dBFS", { alignment: "smpte-rp155" })).value).toBeCloseTo(-20, 9);
  });

  it("custom alignment and the peak-referenced convention (3.01 dB apart for a sine)", () => {
    expect(ok(levelConvert(0, "dBFS", "dBu", { alignment: { dbfs: -18, dbu: 0 } })).value).toBeCloseTo(18, 9);
    const sine = ok(levelConvert(4, "dBu", "dBFS", { alignment: "ebu-r68", convention: "sine" })).value;
    const peak = ok(levelConvert(4, "dBu", "dBFS", { alignment: "ebu-r68", convention: "peak" })).value;
    expect(sine - peak).toBeCloseTo(10 * Math.log10(2), 12);
    expect(ok(levelConvert(4, "dBu", "dBFS", { alignment: "ebu-r68" })).notes.join(" ")).toMatch(/AES17/);
  });

  it("[X] 94 dB SPL = 1.0023745 Pa; 1 Pa = 93.9794 dB SPL; µPa said", () => {
    const r = ok(levelConvert(94, "dBSPL", "Pa"));
    expect(r.value).toBeCloseTo(1.0023745, 7);
    expect(r.notes.join(" ")).toMatch(/µPa/);
    expect(ok(levelConvert(1, "Pa", "dBSPL")).value).toBeCloseTo(93.9794, 4);
  });

  it("[X] 10 mV/Pa = −40.000 dBV/Pa", () => {
    expect(ok(levelConvert(10, "mVPa", "dBVPa")).value).toBeCloseTo(-40, 10);
  });

  it("[X] 1 W sound power = 120.000 dB SWL re 1 pW", () => {
    expect(ok(levelConvert(1, "W", "dBSWL")).value).toBeCloseTo(120, 10);
  });

  it("SPL ↔ dBu only through a microphone sensitivity", () => {
    expect(refused(levelConvert(94, "dBSPL", "dBu"))).toMatch(/microphone/);
    // 94 dB SPL into 10 mV/Pa: 10.024 mV = −39.98 dBV
    const r = ok(levelConvert(94, "dBSPL", "dBV", { micSensitivityVPerPa: 0.01 }));
    expect(r.value).toBeCloseTo(20 * Math.log10(0.010023745), 6);
  });

  it("refusals by name: dBFS without alignment, power ↔ pressure, sensitivity ↔ level", () => {
    expect(refused(levelConvert(-18, "dBFS", "dBu"))).toMatch(/relative to the converter/);
    expect(refused(levelConvert(4, "dBu", "dBFS"))).toMatch(/choose an alignment/);
    expect(refused(levelConvert(100, "dBSWL", "dBSPL"))).toMatch(/distance and the directivity/);
    expect(refused(levelConvert(10, "mVPa", "dBu"))).toMatch(/RATIO/);
  });

  it("the ladder figure has every scale and the marker", () => {
    const r = ok(levelConvert(4, "dBu", "dBV", { alignment: "ebu-r68" }));
    checkFigure(r.figure);
    expect(r.figure.kind).toBe("ladder");
    expect(r.figure.ladder!.map((s) => s.name)).toEqual(["dBu", "dBV", "dBFS (AES17)", "V rms"]);
    expect(r.figure.markers![0].at).toBeCloseTo(4, 9);
    // the dBV scale's "0" tick sits at +2.2185 dBu
    const zero = r.figure.ladder![1].ticks.find((t) => t.label === "0")!;
    expect(zero.at).toBeCloseTo(2.2185, 4);
    for (const ref of ["dBSPL", "dBSWL", "dBVPa"] as const) {
      checkFigure(ok(levelConvert(50, ref, ref)).figure);
    }
  });
});

describe("§D1 level arithmetic", () => {
  it("[X] sum 80, 80, 74 = 83.5241", () => {
    const r = ok(levelSum([80, 80, 74]));
    expect(r.totalDb).toBeCloseTo(83.5241, 4);
    expect(r.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    checkFigure(r.figure);
  });

  it("[X] 85 total − 80 background = 83.3491", () => {
    const r = ok(levelSubtract(85, 80));
    expect(r.sourceDb).toBeCloseTo(83.3491, 4);
    checkFigure(r.figure);
  });

  it("82 − 80 (Δ = 2) refused; Δ = 3 accepted; Δ ≤ 0 is 'background ≥ total'", () => {
    expect(refused(levelSubtract(82, 80))).toMatch(/within 3 dB/);
    const at3 = ok(levelSubtract(83, 80));
    expect(at3.sourceDb).toBeCloseTo(83 + 10 * Math.log10(1 - Math.pow(10, -0.3)), 12);
    expect(refused(levelSubtract(80, 80))).toMatch(/background ≥ total/);
    expect(refused(levelSubtract(79, 80))).toMatch(/background ≥ total/);
  });

  it("[X] Leq of 70, 80, 90 (equal time) = 85.6820; durations weight it", () => {
    const r = ok(levelAverage([70, 80, 90]));
    expect(r.leqDb).toBeCloseTo(85.682, 4);
    expect(r.arithmeticMeanDb).toBeCloseTo(80, 12);
    // 90 dB for 1 h and 70 dB for 7 h: 10·log10((1e9 + 7e7)/8)
    expect(ok(levelAverage([90, 70], [1, 7])).leqDb).toBeCloseTo(10 * Math.log10((1e9 + 7e7) / 8), 10);
    checkFigure(r.figure);
  });

  it("[X] two coherent 80s: in phase 86.0206, 90° 83.0103", () => {
    expect(ok(coherentSum([80, 80], [0, 0])).totalDb).toBeCloseTo(86.0206, 4);
    expect(ok(coherentSum([80, 80], [0, 90])).totalDb).toBeCloseTo(83.0103, 4);
    const r = ok(coherentSum([80, 80], [0, 90]));
    expect(r.incoherentDb).toBeCloseTo(83.0103, 4);
    checkFigure(r.figure);
  });

  it("point vs line source falloff", () => {
    expect(ok(distanceFalloff(90, 1, 2, "point")).changeDb).toBeCloseTo(-6.0206, 4);
    expect(ok(distanceFalloff(90, 1, 2, "line")).changeDb).toBeCloseTo(-3.0103, 4);
  });
});

describe("§D1 frequency weighting (IEC 61672-1:2013)", () => {
  it("the Annex E poles come out at the standard's 20.6 / 107.7 / 737.9 / 12194 Hz", () => {
    expect(IEC61672_POLES.f1).toBeCloseTo(20.598997, 5);
    expect(IEC61672_POLES.f2).toBeCloseTo(107.65265, 4);
    expect(IEC61672_POLES.f3).toBeCloseTo(737.86223, 4);
    expect(IEC61672_POLES.f4).toBeCloseTo(12194.217, 2);
  });

  it("[F]+[P] A₁₀₀₀ / C₁₀₀₀ computed −1.99966 / −0.06190 (printed −2.000 / −0.062); A(1k) = 0 exactly", () => {
    expect(A1000_DB).toBeCloseTo(-1.99966, 5);
    expect(C1000_DB).toBeCloseTo(-0.0619, 5);
    expect(weightingDb(1000, "A")).toBe(0);
    expect(weightingDb(1000, "C")).toBe(0);
  });

  const exact = (n: number) => 1000 * Math.pow(10, n / 10);
  const tableA: [number, number][] = [
    [-20, -70.4],
    [-15, -39.4],
    [-12, -26.2],
    [-10, -19.1],
    [-9, -16.1],
    [-6, -8.6],
    [-3, -3.2],
    [0, 0.0],
    [3, 1.2],
    [6, 1.0],
    [9, -1.1],
    [10, -2.5],
    [12, -6.6],
    [13, -9.3],
  ];
  it.each(tableA)("[P] A-weighting at 1000·10^(%i/10) Hz matches IEC 61672-1 Table 3 (%f dB) to 0.05", (n, db) => {
    expect(Math.abs(ok(weighting(exact(n), "A")).db - db)).toBeLessThanOrEqual(0.05);
  });

  it.each([
    [-15, -3.0],
    [-12, -0.8],
    [9, -3.0],
    [12, -8.5],
  ] as [number, number][])("[P] C-weighting at 1000·10^(%i/10) Hz = %f dB (Table 3)", (n, db) => {
    expect(Math.abs(ok(weighting(exact(n), "C")).db - db)).toBeLessThanOrEqual(0.05);
  });

  it("[F] at the NOMINAL 31.5 / 16000 Hz the formula gives −39.52 / −6.71 — NOT the table (pins the base-10 rule)", () => {
    const a = ok(weighting(31.5, "A"));
    expect(a.db).toBeCloseTo(-39.525, 3);
    expect(Math.abs(a.db - -39.4)).toBeGreaterThan(0.05);
    expect(ok(weighting(16000, "A")).db).toBeCloseTo(-6.706, 3);
    expect(a.notes.join(" ")).toMatch(/31\.62 Hz/);
  });

  it("exact band frequencies snap nominal labels and leave non-bands alone", () => {
    expect(exactBandFrequency(31.5).exactHz).toBeCloseTo(31.6228, 4);
    expect(exactBandFrequency(31.5).isBand).toBe(true);
    expect(exactBandFrequency(16000).isBand).toBe(true);
    expect(exactBandFrequency(1100).isBand).toBe(false);
  });

  it("[F]+[X] octave 63–8k at 80 dB → 86.974 dB(A) at exact f; dB(Z) 89.031", () => {
    const f = list(parseBandList("63, 125, 250, 500, 1k, 2k, 4k, 8k"));
    expect(f).toEqual([63, 125, 250, 500, 1000, 2000, 4000, 8000]);
    const r = ok(bandsToWeighted(f, f.map(() => 80), "A"));
    expect(r.totalDb).toBeCloseTo(86.974, 3);
    expect(r.totalZDb).toBeCloseTo(80 + 10 * Math.log10(8), 10);
    expect(r.totalZDb).toBeCloseTo(89.031, 3);
    // the table's rounded weights give 86.987 — the brief's second landmark
    const tableSum = 10 * Math.log10(r.bands.reduce((s, b) => s + Math.pow(10, (80 + Math.round(b.weightDb * 10) / 10) / 10), 0));
    expect(tableSum).toBeCloseTo(86.987, 3);
    expect(r.bands.filter((b) => b.snapped).length).toBe(7); // 1000 needs no snap
    checkFigure(r.figure);
  });
});

describe("§D1 dither, oversampling, file size", () => {
  it("[X] 16-bit ideal / RPDF / TPDF = 98.0905 / 95.0802 / 93.3193", () => {
    expect(ok(ditherBudget(16, "none")).idealSnrDb).toBeCloseTo(98.0905, 4);
    expect(ok(ditherBudget(16, "rpdf")).inBandSnrDb).toBeCloseTo(95.0802, 4);
    expect(ok(ditherBudget(16, "tpdf")).inBandSnrDb).toBeCloseTo(93.3193, 4);
  });

  it("[X] 24-bit ideal / TPDF = 146.2553 / 141.4841; OSR 4 / 64 = +6.0206 / +18.0618", () => {
    expect(ok(ditherBudget(24, "none")).idealSnrDb).toBeCloseTo(146.2553, 4);
    expect(ok(ditherBudget(24, "tpdf")).inBandSnrDb).toBeCloseTo(141.4841, 4);
    expect(ok(ditherBudget(16, "none", 4)).oversamplingGainDb).toBeCloseTo(6.0206, 4);
    expect(ok(ditherBudget(16, "none", 64)).oversamplingGainDb).toBeCloseTo(18.0618, 4);
    const r = ok(ditherBudget(16, "tpdf", 4, -12));
    expect(r.inBandSnrDb).toBeCloseTo(93.3193 - 12 + 6.0206, 4);
    expect(r.noiseFloorDbfs).toBeCloseTo(-(93.3193 + 6.0206), 4);
    checkFigure(r.figure);
  });

  it("noise shaping is refused by name", () => {
    expect(refused(ditherBudget(16, "shaped"))).toMatch(/shaping filter/);
  });

  it("[X] PCM 48k/24/2 = 2,304,000 bit/s and 1.0368 GB per hour", () => {
    const r = ok(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 2, durationS: 3600 }));
    expect(r.bitRate).toBe(2304000);
    expect(r.sizeGB).toBeCloseTo(1.0368, 10);
    expect(r.sizeGiB).toBeCloseTo(1.0368e9 / 2 ** 30, 10);
    checkFigure(r.figure);
  });

  it("[X] CD 44.1k/16/2, 74 min = 1,411,200 bit/s and 783,216,000 B", () => {
    const r = ok(audioSize({ mode: "pcm", fs: 44100, bits: 16, channels: 2, durationS: 74 * 60 }));
    expect(r.bitRate).toBe(1411200);
    expect(r.sizeBytes).toBe(783216000);
  });

  it("[X] WAV ceiling at 48k/24/2 = (2³² − 1 − 36)/288000 = 14913.08 s = 4.1425 h", () => {
    const r = ok(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 2, durationS: 3600 }));
    expect(WAV_MAX_DATA_BYTES).toBe(4294967259);
    expect(r.wavMaxSeconds!).toBeCloseTo(14913.08, 2);
    expect(r.wavMaxSeconds! / 3600).toBeCloseTo(4.1425, 4);
    expect(r.exceedsWav).toBe(false);
    const long = ok(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 2, durationS: 5 * 3600 }));
    expect(long.exceedsWav).toBe(true);
    expect(long.notes.join(" ")).toMatch(/RF64/);
  });

  it("compressed 320 kbit/s; size → duration", () => {
    const r = ok(audioSize({ mode: "compressed", bitRate: 320000, durationS: 3600 }));
    expect(r.sizeBytes).toBe(144e6);
    expect(r.wavMaxSeconds).toBeNull();
    expect(ok(audioSize({ mode: "compressed", bitRate: 320000, sizeBytes: 144e6 })).durationS).toBeCloseTo(3600, 9);
  });
});

describe("§D1 loudspeaker", () => {
  it("[X] 88 dB/1 W, 100 W, 4 m = 95.9588 dB SPL; 100 dB at 4 m needs 253.58 W", () => {
    const r = ok(
      speakerSpl({ sensitivityDb: 88, basis: "1W", impedanceOhm: 8, powerW: 100, distanceM: 4, targetSplDb: 100, crestDb: 12 }),
    );
    expect(r.splDb).toBeCloseTo(95.9588, 4);
    expect(r.powerForTargetW!).toBeCloseTo(253.58, 2);
    expect(r.peakSplDb).toBeCloseTo(95.9588 + 12, 4);
    checkFigure(r.figure);
  });

  it("[X] 2.83 V into 4 Ω / 8 Ω = 2.00223 W (+3.0151 dB) / 1.00111 W (+0.0048 dB)", () => {
    const four = ok(speakerSpl({ sensitivityDb: 88, basis: "2.83V", impedanceOhm: 4, powerW: 1, distanceM: 1 }));
    expect(four.wattsAt283V).toBeCloseTo(2.00223, 5);
    expect(four.basisOffsetDb).toBeCloseTo(3.0151, 4);
    expect(four.sensitivity1W).toBeCloseTo(88 - 3.0151, 4);
    expect(four.notes.join(" ")).toMatch(/flatters/);
    const eight = ok(speakerSpl({ sensitivityDb: 88, basis: "2.83V", impedanceOhm: 8, powerW: 1, distanceM: 1 }));
    expect(eight.wattsAt283V).toBeCloseTo(1.00111, 5);
    expect(eight.basisOffsetDb).toBeCloseTo(0.0048, 4);
  });

  it("n boxes: +10·log n incoherent, +20·log n coherent (upper bound, said)", () => {
    const base = { sensitivityDb: 90, basis: "1W" as const, impedanceOhm: 8, powerW: 1, distanceM: 1 };
    expect(ok(speakerSpl({ ...base, boxes: 2 })).splDb).toBeCloseTo(90 + 3.0103, 4);
    const coh = ok(speakerSpl({ ...base, boxes: 2, coherent: true }));
    expect(coh.splDb).toBeCloseTo(90 + 6.0206, 4);
    expect(coh.notes.join(" ")).toMatch(/UPPER BOUND/);
  });

  it("[F] c at 20 °C = 343.21 m/s", () => {
    // SI kelvin, as the pane's unit reader delivers "20 °C"
    expect(ok(speedOfSound(293.15)).speed).toBeCloseTo(343.21, 2);
    expect(ok(speedOfSound(293.15, 1000)).wavelengthM!).toBeCloseTo(0.34321, 4);
    expect(ok(speedOfSound(273.15)).speed).toBe(331.3);
  });
});

describe("§D1 rooms", () => {
  it("[F] Dc at V 200, T 0.6708: Q = 1 → 0.98420, Q = 2 → 1.39187; √(QA/16π) → 1.38198", () => {
    const q1 = ok(reverbTime(200, 240, 0.2));
    expect(q1.criticalDistance).toBeCloseTo(0.9842, 4);
    expect(q1.directivityQ).toBe(1);
    expect(q1.notes.join(" ")).toMatch(/Q = 1, which is an OMNIDIRECTIONAL source/);
    const q2 = ok(reverbTime(200, 240, 0.2, 2));
    expect(q2.criticalDistance).toBeCloseTo(1.39187, 4);
    expect(q2.criticalDistance / q1.criticalDistance).toBeCloseTo(Math.SQRT2, 12);
    expect(q2.criticalDistanceExact).toBeCloseTo(1.38198, 5);
    expect(q2.notes.join(" ")).toMatch(/Q = 2/);
    // the existing pins are unchanged by the new parameter
    expect(q2.sabineS).toBeCloseTo(q1.sabineS, 15);
  });

  it("[F] per-surface 60·0.02 + 60·0.6 + 120·0.1, V 200: A 49.2; Sabine/Eyring/M–S 0.65447/0.58483/0.46780", () => {
    const surf = list(parseSurfaceList("60, 0.02 / 60, 0.6 / 120, 0.1"));
    const r = ok(absorptionBudget(200, surf));
    expect(r.absorption).toBeCloseTo(49.2, 12);
    expect(r.sabineS).toBeCloseTo(0.65447, 5);
    expect(r.eyringS).toBeCloseTo(0.58483, 5);
    expect(r.millingtonSetteS).toBeCloseTo(0.4678, 5);
    expect(r.dominantIndex).toBe(1);
    checkFigure(r.figure);
  });

  it("[F] + 4mV with m = 0.0024 → Sabine 0.62989 s", () => {
    const surf = [
      { area: 60, alpha: 0.02 },
      { area: 60, alpha: 0.6 },
      { area: 120, alpha: 0.1 },
    ];
    expect(ok(absorptionBudget(200, surf, 0.0024)).sabineS).toBeCloseTo(0.62989, 5);
  });

  it("[F] target 0.5 s needs A = 64.4 m² sabins: +15.2 over the present 49.2 (the brief's +16.4 is 64.4 − 48, the other room)", () => {
    const surf = [
      { area: 60, alpha: 0.02 },
      { area: 60, alpha: 0.6 },
      { area: 120, alpha: 0.1 },
    ];
    const r = ok(absorptionBudget(200, surf, 0, 0.5));
    expect(r.requiredAbsorption!).toBeCloseTo(64.4, 10);
    expect(r.addedAbsorption!).toBeCloseTo(15.2, 10);
  });
});

describe("§D1 passive crossover", () => {
  it("[F] 2.5 kHz, 8 Ω: C 7.9577 / 5.6270 / 3.9789 µF; L 0.50930 / 0.72025 / 1.01859 mH", () => {
    const one = ok(passiveCrossover(2500, 8, "1st"));
    const bw = ok(passiveCrossover(2500, 8, "bw2"));
    const lr = ok(passiveCrossover(2500, 8, "lr2"));
    expect(one.capacitanceF * 1e6).toBeCloseTo(7.9577, 4);
    expect(bw.capacitanceF * 1e6).toBeCloseTo(5.627, 4);
    expect(lr.capacitanceF * 1e6).toBeCloseTo(3.9789, 4);
    expect(one.inductanceH * 1e3).toBeCloseTo(0.5093, 5);
    expect(bw.inductanceH * 1e3).toBeCloseTo(0.72025, 5);
    expect(lr.inductanceH * 1e3).toBeCloseTo(1.01859, 5);
    // [X] landmark: every section's L·C = 1/ω², whatever the type
    const w = 2 * Math.PI * 2500;
    for (const r of [one, bw, lr]) expect(r.inductanceH * r.capacitanceF * w * w).toBeCloseTo(1, 12);
  });

  it("[L scipy butter+freqs] summed at fc: BW2 null / +3.010 inverted; LR2 null / 0.000; sections −3.01 / −6.02", () => {
    const bw = ok(passiveCrossover(2500, 8, "bw2"));
    expect(bw.sumAtFcInPhaseDb).toBeNull();
    expect(bw.sumAtFcInvertedDb!).toBeCloseTo(3.0103, 3);
    expect(bw.sectionAtFcDb).toBeCloseTo(-3.0103, 6);
    expect(bw.tweeterPolarity).toBe("inverted");
    const lr = ok(passiveCrossover(2500, 8, "lr2"));
    expect(lr.sumAtFcInPhaseDb).toBeNull();
    expect(lr.sumAtFcInvertedDb!).toBeCloseTo(0, 6);
    expect(lr.sectionAtFcDb).toBeCloseTo(-6.0206, 6);
    const one = ok(passiveCrossover(2500, 8, "1st"));
    expect(one.sumAtFcInPhaseDb!).toBeCloseTo(0, 9);
    expect(one.tweeterPolarity).toBe("in phase");
  });

  it("[L scipy] BW2 off-fc sums: inverted +1.1794 at 1 kHz, +2.8713 at 3 kHz; in phase −10.3649 at 2 kHz", () => {
    const db = (f: number, which: "in phase" | "inverted") => crossoverResponseDb(2500, "bw2", f, which) as number;
    expect(db(1000, "inverted")).toBeCloseTo(1.17938, 4);
    expect(db(3000, "inverted")).toBeCloseTo(2.87132, 4);
    expect(db(5000, "inverted")).toBeCloseTo(1.67491, 4);
    expect(db(2000, "in phase")).toBeCloseTo(-10.36491, 4);
    expect(db(3000, "in phase")).toBeCloseTo(-12.00742, 4);
    expect(crossoverResponseDb(2500, "bw2", 2500, "in phase")).toBeNull();
    // LR2 inverted is an all-pass: 0 dB everywhere (scipy: |≤ 2e-15| at 100 Hz – 20 kHz)
    for (const f of [100, 1000, 10000, 20000]) {
      expect(crossoverResponseDb(2500, "lr2", f, "inverted") as number).toBeCloseTo(0, 9);
    }
  });

  it("the composition through filter.ts agrees with the closed form across the band", () => {
    const wc = 2 * Math.PI * 2500;
    const lp = designFilter({ family: "butterworth", kind: "lowpass", wp: wc, ws: 10 * wc, ap: 10 * Math.log10(2), as: 20, forceOrder: 2 });
    if (!lp.ok) throw new Error(lp.error);
    expect(lp.den[1] / wc).toBeCloseTo(Math.SQRT2, 9);
    expect(lp.den[2] / (wc * wc)).toBeCloseTo(1, 9);
    const r = ok(passiveCrossover(2500, 8, "bw2"));
    const lpSeries = r.figure.series![0].points;
    for (const p of lpSeries) {
      const w = 2 * Math.PI * p.x;
      const closed = -10 * Math.log10(1 + Math.pow(w / wc, 4));
      expect(p.y).toBeCloseTo(Math.max(-40, closed), 6);
    }
    checkFigure(r.figure);
  });

  it("LR4 and 3rd order are refused by name; the resistive-load limit is said", () => {
    expect(refused(passiveCrossover(2500, 8, "lr4"))).toMatch(/LR4/);
    expect(ok(passiveCrossover(2500, 8, "lr2")).notes.join(" ")).toMatch(/Zobel/);
  });
});

describe("§D1 speaker cable", () => {
  it("[P] copper ρ = 1/58 = 1.7241379e-8 Ω·m (IEC 60028)", () => {
    expect(COPPER_RHO_OHM_MM2_PER_M * 1e-6).toBeCloseTo(1.7241379e-8, 15);
  });

  it("[X] 2 × 10 m of 2.5 mm², 8 Ω, Zout 0.02: R 0.137931; DF 50.655; −0.1698 dB vs an ideal source", () => {
    // SI: "2.5 mm²" arrives from the unit reader as 2.5e-6 m²
    const r = ok(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, areaM2: 2.5e-6 }));
    expect(r.areaMm2).toBeCloseTo(2.5, 12);
    expect(r.cableOhm).toBeCloseTo(0.137931, 6);
    expect(r.dampingFactor).toBeCloseTo(50.655, 3);
    expect(r.lossDb).toBeCloseTo(-0.1698, 4);
    expect(r.cableInsertionLossDb).toBeCloseTo(20 * Math.log10(8.02 / (8.02 + 20 / (58 * 2.5))), 10);
    expect(r.amplifierDampingFactor).toBeCloseTo(400, 9);
    checkFigure(r.figure);
  });

  it("[P] AWG 12 = 2.05253 mm, 3.30877 mm² (ASTM B258)", () => {
    expect(awgDiameterMm(12)).toBeCloseTo(2.05253, 5);
    const r = ok(cableDamping({ loadOhm: 8, sourceOhm: 0, lengthM: 10, awg: 12 }));
    expect(r.areaMm2).toBeCloseTo(3.30877, 5);
    expect(r.amplifierDampingFactor).toBeNull();
    // AWG 36 is exactly 0.127 mm by definition
    expect(awgDiameterMm(36)).toBe(0.127);
  });
});

describe("parsers accept their shipped defaults verbatim", () => {
  it("band list with 1k", () => {
    expect(list(parseBandList("63, 125, 250, 500, 1k, 2k, 4k, 8k"))).toEqual([63, 125, 250, 500, 1000, 2000, 4000, 8000]);
    expect(list(parseBandList("31.5 Hz, 1 kHz, 16k"))).toEqual([31.5, 1000, 16000]);
    expect(list(parseBandList("63,125,1k,2.5k"))).toEqual([63, 125, 1000, 2500]);
    // decimal comma by the product-wide rule, and said
    const dc = parseBandList("31,5 63 125");
    expect(list(dc)).toEqual([31.5, 63, 125]);
    expect(dc.ok && dc.note).toMatch(/decimal comma/);
    expect(parseBandList("1,25k 2,5k").ok).toBe(false);
    expect(parseBandList("2,5k").ok).toBe(false);
  });
  it("level list", () => {
    expect(list(parseLevelList("80, 80, 74"))).toEqual([80, 80, 74]);
    expect(list(parseLevelList("−10; +4\n80dB"))).toEqual([-10, 4, 80]);
    expect(list(parseLevelList("80 dB, 80 dB(A), 74 dBA"))).toEqual([80, 80, 74]);
    expect(list(parseLevelList("80,80,74"))).toEqual([80, 80, 74]);
    const dc = parseLevelList("80,5; 79,2");
    expect(list(dc)).toEqual([80.5, 79.2]);
    expect(dc.ok && dc.note).toMatch(/80,5 → 80\.5/);
    expect(parseLevelList("80, loud, 74").ok).toBe(false);
  });
  it("[X] references are never stripped silently: one is said; mixed electrical are converted; mixed weightings refused", () => {
    const one = parseLevelList("80 dB(A), 74 dB(A), 70");
    expect(list(one)).toEqual([80, 74, 70]);
    expect(one.ok && one.reference).toBe("dB(A)");
    expect(one.ok && one.note).toMatch(/read in dB\(A\)/);
    const mixed = parseLevelList("0 dBu, 0 dBV");
    const v = list(mixed);
    expect(v[0]).toBe(0);
    expect(v[1]).toBeCloseTo(2.2185, 4);
    expect(mixed.ok && mixed.note).toMatch(/converted to dBu/);
    // [X] incoherent sum in dBu: 10·log₁₀(1 + 10^(2.2185/10)) = 10·log₁₀(8/3) = 4.2597
    // (the review note's 4.3934 does not follow from its own formula)
    expect((levelSum(v) as { totalDb: number }).totalDb).toBeCloseTo(10 * Math.log10(1 + 1 / 0.6), 9);
    expect((levelSum(v) as { totalDb: number }).totalDb).toBeCloseTo(4.2597, 4);
    expect(list(parseLevelList("0 dBV, 4 dBu"))[1]).toBeCloseTo(1.7815, 4);
    expect(refused(parseLevelList("80 dB(A), 80 dB(C)"))).toMatch(/different frequency weightings/);
    expect(refused(parseLevelList("80 dBA, 80 dB SPL"))).toMatch(/weightings/);
    expect(refused(parseLevelList("-18 dBFS, 0 dBu"))).toMatch(/alignment/);
    expect(refused(parseLevelList("0 dBu, 0 dBV, 3"))).toMatch(/EVERY level/);
    expect(parseLevelList("80 dB SPL, 80 dB(Z)").ok).toBe(true);
  });
  it("+2 dBFS (AES17) is said to exceed a full-scale sine, not to clip; +5 dBFS out of dBu does clip", () => {
    const r = ok(levelConvert(2, "dBFS", "dBu", { alignment: "ebu-r68" }));
    expect(r.notes[0]).toMatch(/above a full-scale sine/);
    expect(r.notes.some((n) => /clips/.test(n))).toBe(false);
    const over = ok(levelConvert(23, "dBu", "dBFS", { alignment: "ebu-r68" }));
    expect(over.notes[0]).toMatch(/ABOVE full scale.*clips/);
  });
  it("20-bit WAV size is the 3-byte container size, said", () => {
    const r = ok(audioSize({ mode: "pcm", fs: 48000, bits: 20, channels: 2, durationS: 3600 }));
    expect(r.bitRate).toBe(1920000);
    expect(r.sizeBytes).toBe(48000 * 2 * 3 * 3600);
    expect(r.notes.join(" ")).toMatch(/3-byte containers/);
  });
  it("surface list, slash- or newline-separated", () => {
    const want = [
      { area: 60, alpha: 0.02 },
      { area: 60, alpha: 0.6 },
      { area: 120, alpha: 0.1 },
    ];
    expect(list(parseSurfaceList("60, 0.02 / 60, 0.6 / 120, 0.1"))).toEqual(want);
    expect(list(parseSurfaceList("60, 0.02\n60, 0.6\n120 m², 0.1"))).toEqual(want);
    expect(list(parseSurfaceList("60 0,02 / 60 0,6 / 120 0,1"))).toEqual(want);
  });
});
