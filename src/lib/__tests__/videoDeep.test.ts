// Video deepening round (v2.140.0) — §D2 acceptance values and the C-fixes in
// docs/SCOPE-AUDIO-VIDEO-2026-10.md. Oracle classes: [P] published standard,
// [L] colour-science 0.4.7 values recorded in the brief, [X] exact arithmetic.
import {
  bitrate,
  resolution,
  latencyBudget,
  pqToNits,
  nitsToPq,
  sdiLinkFor,
  interfaceRate,
  recordTime,
  chromaPlanes,
  parseRatio,
  parseFrameSize,
  aspect,
  rateFacts,
  pulldown,
  shutter,
  oetf709,
  oetf709Inverse,
  eotf1886,
  eotf1886Inverse,
  eotfSrgb,
  eotfSrgbInverse,
  hlgOetf,
  hlgOetfInverse,
  HLG_A,
  HLG_B,
  HLG_C,
  transfer,
  codeValue,
} from "../video";
import { rat, ratCmp, Rational } from "../timecode";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};
const err = (r: { ok?: boolean; error?: string }): string => {
  if (r.ok !== false) throw new Error("expected a refusal");
  return r.error!;
};
const isRat = (x: Rational | { ok: false; error: string }): Rational => {
  if ("ok" in x) throw new Error(x.error);
  return x;
};
const eqRat = (a: Rational, n: number | bigint, d: number | bigint = 1) => expect(ratCmp(a, rat(n, d))).toBe(0);

describe("C-fix: active-picture rate vs SDI link rate (was WRONG at video.ts:123)", () => {
  it("1080p60 4:2:2 10-bit: active 2.48832 Gbit/s, link 2.970 Gbit/s (+19.36%) [P] ST 274 / ST 424", () => {
    const r = ok(bitrate(1920, 1080, 60, 10, "4:2:2", 1));
    expect(r.activePictureBps).toBe(2_488_320_000);
    expect(r.sdi!.lineRateBps).toBe(2_970_000_000);
    expect(r.sdi!.totalW).toBe(2200);
    expect(r.sdi!.totalH).toBe(1125);
    expect(r.sdi!.overheadPct).toBeCloseTo(19.35764, 5); // 2475000/2073600 − 1
    expect(r.sdi!.sdiClass).toMatch(/3G-SDI, SMPTE ST 424/);
    expect(r.sdi!.exactClass).toBe(true);
    const note = r.notes.join(" ");
    expect(note).toMatch(/ACTIVE-PICTURE/);
    expect(note).toMatch(/2\.48832 Gbit\/s/);
    expect(note).toMatch(/2\.97 Gbit\/s/);
    expect(note).toMatch(/SMPTE ST 274/);
    expect(note).not.toMatch(/what a capture interface must carry/);
    expect(note).toMatch(/YOUR input/); // the old pin still holds
  });

  it("1080p50 uses the 2640-wide raster — still 2.97, not 2.475", () => {
    const r = ok(bitrate(1920, 1080, 50, 10, "4:2:2", 1));
    expect(r.sdi!.totalW).toBe(2640);
    expect(r.sdi!.lineRateBps).toBe(2_970_000_000);
  });

  it("1080i59.94 (29.97 frames) is 1.485/1.001 Gbit/s exactly [P] ST 292-1", () => {
    const r = ok(bitrate(1920, 1080, 29.97, 10, "4:2:2", 1));
    eqRat(r.sdi!.lineRate, 1_485_000_000_000n, 1001n);
    expect(r.sdi!.lineRateBps).toBeCloseTo(1.4835165e9, -2);
    expect(r.sdi!.sdiClass).toMatch(/1\.485\/1\.001/);
  });

  it("every tabulated raster lands EXACTLY on an SDI class (self-check against transcription slips)", () => {
    const cases: [number, number, (string | number)[]][] = [
      [1920, 1080, [24, "23.976", 25, 30, "29.97", 50, 60, "59.94"]],
      [1280, 720, [24, "23.976", 25, 30, "29.97", 50, 60, "59.94"]],
      [3840, 2160, [24, "23.976", 25, 30, "29.97", 50, 60, "59.94"]],
      [720, 486, ["29.97"]],
      [720, 480, ["29.97"]],
      [720, 576, [25]],
    ];
    for (const [w, h, rates] of cases) {
      for (const fps of rates) {
        const l = sdiLinkFor(w, h, fps);
        expect(l.sdi).not.toBeNull();
        expect(l.sdi!.exactClass).toBe(true);
      }
    }
  });

  it("4:4:4 / 12-bit / untabulated formats give no link figure and SAY why", () => {
    expect(sdiLinkFor(1920, 1080, 60, 10, "4:4:4").why).toMatch(/ST 372/);
    expect(sdiLinkFor(1920, 1080, 60, 12, "4:2:2").why).toMatch(/not modelled/);
    expect(sdiLinkFor(2048, 1080, 24).why).toMatch(/No SMPTE raster is tabulated/);
    expect(sdiLinkFor(1920, 1080, 48).why).toMatch(/No SMPTE raster/);
    const r = ok(bitrate(2048, 1080, 24, 10, "4:2:2", 1));
    expect(r.sdi).toBeNull();
    expect(r.notes.join(" ")).toMatch(/also carries blanking/);
  });

  it("4:2:0 and 8-bit sources are said to travel in the 4:2:2 10-bit mapping", () => {
    expect(ok(bitrate(1920, 1080, 25, 8, "4:2:0", 1)).notes.join(" ")).toMatch(/no 4:2:0 mapping/);
    expect(ok(bitrate(1920, 1080, 25, 8, "4:2:2", 1)).notes.join(" ")).toMatch(/10-bit words/);
  });

  it("interfaceRate: user raster, nearest class above, figure bars", () => {
    const r = ok(interfaceRate(1920, 1080, 60, 2200, 1125));
    expect(r.figure.bars.map((b) => b.label)).toEqual(["Active picture", "Blanking", "SDI class"]);
    expect(r.figure.bars[0].bps + r.figure.bars[1].bps).toBeCloseTo(2.97e9, -1);
    const odd = ok(interfaceRate(1920, 1080, 60, 2300, 1125));
    expect(odd.sdiClass!.exact).toBe(false);
    expect(odd.sdiClass!.name).toMatch(/6G/);
    expect(err(interfaceRate(1920, 1080, 60, 1900, 1125))).toMatch(/cannot be smaller/);
  });

  it("recording time: 100 Mbit/s = 45 GB/h; 128 GB → 10240 s; 128 GB = 119.209 GiB [X]", () => {
    const r = ok(recordTime(100e6, 128e9));
    expect(r.gbPerHour).toBeCloseTo(45, 12);
    expect(r.seconds).toBeCloseTo(10240, 9);
    expect(r.hms).toBe("2:50:40");
    expect(r.capacityGiB).toBeCloseTo(119.209, 3);
  });
});

describe("chroma planes", () => {
  it("4:2:0 is half of 4:4:4; odd sizes round chroma up", () => {
    expect((chromaPlanes(1920, 1080, "4:2:0") as { fractionOf444: number }).fractionOf444).toBeCloseTo(0.5, 12);
    const p = chromaPlanes(1921, 1081, "4:2:0") as { chromaEach: number };
    expect(p.chromaEach).toBe(961 * 541);
  });
});

describe("C-fix: latency frames are exact integers, never billed a frame that is not there", () => {
  it("one stage of 15 × (1000/23.976) ms at 23.976 Hz → 15 frames", () => {
    const r = ok(latencyBudget([{ name: "x", ms: 15 * (1000 / 23.976) }], 23.976));
    expect(r.frames).toBe(15);
    expect(Number.isInteger(r.frames)).toBe(true);
  });

  it("four stages 0.1/0.2/0.3/0.4 × (1000/24) at 24 Hz → 1 frame", () => {
    const fm = 1000 / 24;
    const r = ok(latencyBudget([0.1, 0.2, 0.3, 0.4].map((k, i) => ({ name: `s${i}`, ms: k * fm })), 24));
    expect(r.frames).toBe(1);
  });

  it("sweep: k·(1000/rate) gives exactly k frames for k = 1..500 at every broadcast rate", () => {
    for (const hz of [23.976, 24, 25, 29.97, 30000 / 1001, 50, 59.94, 60000 / 1001, 60, 120]) {
      for (let k = 1; k <= 500; k++) {
        const r = latencyBudget([{ name: "x", ms: k * (1000 / hz) }], hz);
        if (!r.ok || r.frames !== k) throw new Error(`${hz} Hz, k=${k}: ${r.ok ? r.frames : r.error}`);
      }
    }
  });

  it("a REAL overshoot is still billed (the tolerance is 1e-9, not a fudge)", () => {
    expect(ok(latencyBudget([{ name: "x", ms: 16.67 }], 60)).frames).toBe(2); // 1.0002 frames
    expect(ok(latencyBudget([{ name: "x", ms: 41.67 }], 24)).frames).toBe(2);
  });

  it("the shipped pin holds: 63 ms at 60 Hz → 4 frames, 66.667 ms", () => {
    const r = ok(latencyBudget([{ name: "a", ms: 5 }, { name: "b", ms: 20 }, { name: "c", ms: 30 }, { name: "d", ms: 8 }], 60));
    expect(r.frames).toBe(4);
    expect(r.quantisedMs).toBeCloseTo(66.667, 3);
  });

  it("zero total is zero frames", () => {
    expect(ok(latencyBudget([{ name: "x", ms: 0 }], 60)).frames).toBe(0);
  });
});

describe("C-fix: resolution says STORAGE aspect and names the nearest common one", () => {
  it("1366×768 ≈ 16:9 (true 1.7786); 720×480 stores 3:2 and the note says pixel aspect", () => {
    const r = ok(resolution(1366, 768));
    expect(r.aspectLabel).toBe("683:384");
    expect(r.storageAspectLabel).toBe("683:384");
    expect(r.nearestCommon.name).toBe("16:9");
    expect(r.nearestCommon.exact).toBe(false);
    expect(r.notes.join(" ")).toMatch(/1\.7786/);
    const sd = ok(resolution(720, 480));
    expect(sd.notes.join(" ")).toMatch(/STORAGE aspect/);
    expect(ok(resolution(1920, 1080)).nearestCommon.exact).toBe(true);
  });
});

describe("PQ hardening", () => {
  it("clamps above the 10000-nit ceiling instead of returning 74,604 nits", () => {
    expect(pqToNits(1.2)).toBeCloseTo(pqToNits(1), 9);
    expect(nitsToPq(20000)).toBeCloseTo(nitsToPq(10000), 12);
  });
});

describe("aspect, pixel aspect and framing — §D2", () => {
  it("parses the shipped defaults verbatim", () => {
    eqRat(isRat(parseRatio("10:11")), 10, 11);
    eqRat(isRat(parseRatio("4:3")), 4, 3);
    eqRat(isRat(parseRatio("2.39")), 239, 100);
    eqRat(isRat(parseRatio("2.39:1")), 239, 100);
    eqRat(isRat(parseRatio("16/9")), 16, 9);
    expect(parseFrameSize("1920×1080")).toEqual({ w: 1920, h: 1080 });
    expect(parseFrameSize("1920x1080")).toEqual({ w: 1920, h: 1080 });
    expect(err(parseFrameSize("1920 by 1080") as { ok: false; error: string })).toMatch(/not a frame size/);
    expect(err(parseRatio("4:0") as { ok: false; error: string })).toMatch(/non-zero/);
  });

  it("720×480 at 4:3 → PAR 8:9 (720 basis) and 10:11 (BT.601 704 basis) [P]", () => {
    const r = ok(aspect({ width: 720, height: 480, dar: "4:3" }));
    expect(r.parText).toBe("8:9");
    expect(r.sdConventions!.map((c) => c.par)).toEqual(["8:9", "10:11"]);
  });

  it("720×576 at 4:3 → 16:15 and 12:11 [P]", () => {
    const r = ok(aspect({ width: 720, height: 576, dar: "4:3" }));
    expect(r.sdConventions!.map((c) => c.par)).toEqual(["16:15", "12:11"]);
  });

  it("720×480 with PAR 10:11 displays 15:11 storage-times-par (not 4:3 — the 704 convention)", () => {
    const r = ok(aspect({ width: 720, height: 480, par: "10:11" }));
    expect(r.darText).toBe("15:11");
    expect(r.nearestCommon.name).toBe("4:3");
    expect(r.nearestCommon.exact).toBe(false);
    // …and the shipped default explains itself: 10:11 is a 704-basis PAR, exactly 4:3 there.
    expect(r.darOn704).toBe("4:3");
    expect(r.notes.join(" ")).toMatch(/704 active samples: 704×480 at 10:11 displays exactly 4:3/);
    expect(ok(aspect({ width: 720, height: 576, par: "12:11" })).darOn704).toBe("4:3");
    expect(ok(aspect({ width: 720, height: 480, par: "8:9" })).darText).toBe("4:3");
    expect(ok(aspect({ width: 720, height: 480, par: "8:9" })).darOn704).toBeNull();
  });

  it("2.39 in 1920×1080: 803.347 lines; bars 138.33 exact, 138 at an even 804 [X]", () => {
    const r = ok(aspect({ width: 1920, height: 1080, frame: "1920×1080", content: "2.39" }));
    expect(r.framing!.kind).toBe("letterbox");
    expect(r.framing!.activeExact).toBeCloseTo(803.347, 3);
    expect(r.framing!.barEachExact).toBeCloseTo(138.326, 3);
    expect(r.framing!.activeEven).toBe(804);
    expect(r.framing!.barEach).toBe(138);
  });

  it("4:3 in 1920×1080 → 1440 wide, 240 per side [X]", () => {
    const r = ok(aspect({ width: 1920, height: 1080, content: "4:3" }));
    expect(r.framing!.kind).toBe("pillarbox");
    expect(r.framing!.activeExact).toBe(1440);
    expect(r.framing!.barEach).toBe(240);
  });

  it("safe areas at 1080: title 1728×972, action 1785.6×1004.4 [P] ST 2046-1", () => {
    const r = ok(aspect({ width: 1920, height: 1080 }));
    expect(r.safe.titleW).toBeCloseTo(1728, 9);
    expect(r.safe.titleH).toBeCloseTo(972, 9);
    expect(r.safe.actionW).toBeCloseTo(1785.6, 9);
    expect(r.safe.actionH).toBeCloseTo(1004.4, 9);
    expect(r.figure.rects.map((x) => x.label)).toEqual(["Frame", "Action safe (93%)", "Title safe (90%)"]);
  });

  it("refuses PAR and DAR together", () => {
    expect(err(aspect({ width: 720, height: 480, par: "8:9", dar: "4:3" }))).toMatch(/not both/);
  });
});

describe("frame rates, audio per frame, pulldown, shutter — §D2", () => {
  it("48 kHz samples per frame at 23.976 / 24 / 25 / 29.97 / 30 / 59.94 [X]", () => {
    eqRat(ok(rateFacts("23.976")).samplesPerFrame, 2002);
    eqRat(ok(rateFacts(24)).samplesPerFrame, 2000);
    eqRat(ok(rateFacts(25)).samplesPerFrame, 1920);
    eqRat(ok(rateFacts("29.97")).samplesPerFrame, 8008, 5);
    eqRat(ok(rateFacts(30)).samplesPerFrame, 1600);
    eqRat(ok(rateFacts("59.94")).samplesPerFrame, 4004, 5);
  });

  it("29.97 five-frame sequence sums to 8008: three of 1602, two of 1601 (order not asserted)", () => {
    const r = ok(rateFacts("29.97"));
    expect(r.audioCycleFrames).toBe(5);
    expect(r.audioCycleSamples).toBe(8008);
    expect(r.audioSplit).toEqual({ high: 1602, highCount: 3, low: 1601, lowCount: 2 });
    expect(3 * 1602 + 2 * 1601).toBe(8008);
    expect(r.notes.join(" ")).toMatch(/not asserted/);
    expect(ok(rateFacts("59.94")).audioCycleSamples).toBe(4004);
  });

  it("PAL speed-up 24 → 25: +4.1667%, +0.70672 semitones, 100 min → 96 min [X]", () => {
    const r = ok(pulldown(24, 25));
    expect(r.kind).toBe("speed change");
    expect(r.speedPct).toBeCloseTo(4.16667, 5);
    expect(r.semitones).toBeCloseTo(0.70672, 5);
    expect(r.cents).toBeCloseTo(70.672, 3);
    expect(r.runtimeOf100Min).toBeCloseTo(96, 12);
  });

  it("2:3 pulldown 23.976 → 29.97: 4 frames → 10 fields → 5 frames, no speed change [X]", () => {
    const r = ok(pulldown("23.976", "29.97"));
    expect(r.kind).toBe("2:3 pulldown (fields)");
    expect(r.cycle).toEqual({ sourceFrames: 4, targetFrames: 5 });
    expect(r.cadence).toHaveLength(10);
    expect(r.pattern).toEqual(["AA", "BB", "BC", "CD", "DD"]);
    eqRat(r.speed, 1);
  });

  it("24 → 29.97 needs the 0.1% slow-down, said", () => {
    const r = ok(pulldown(24, "29.97"));
    eqRat(r.speed, 1000, 1001);
    expect(r.notes.join(" ")).toMatch(/SLOW by 0\.0999%/);
  });

  it("24 → 60 is a 2:3 frame cadence; 25 → 50 a repeat; 25 → 29.97 refused by name", () => {
    expect(ok(pulldown(24, 60)).pattern.join("")).toBe("AABBBCCDDD");
    expect(ok(pulldown(25, 50)).kind).toBe("repeat");
    expect(err(pulldown(25, "29.97"))).toMatch(/standards conversion/);
    expect(err(pulldown(30, 24))).toMatch(/inverse telecine/);
  });

  it("shutter: 180° at 24 → 1/48 s; 172.8° at 25 → 19.2 ms; 1/50 s at 25 → 180° [X]", () => {
    const a = ok(shutter({ angleDeg: 180 }, 24));
    eqRat(a.time, 1, 48);
    expect(a.timeText).toBe("1/48 s");
    expect(a.timeMs).toBeCloseTo(20.833, 3);
    eqRat(ok(shutter({ angleDeg: 172.8 }, 25)).time, 192, 10000);
    expect(ok(shutter({ timeS: "1/50" }, 25)).angleDeg).toBe(180);
    expect(err(shutter({ angleDeg: 400 }, 24))).toMatch(/360/);
    expect(err(shutter({ timeS: 0.1 }, 24))).toMatch(/longer than one frame/);
  });
});

describe("transfer functions — §D2 [L] colour-science / [P] constants", () => {
  it("BT.709 OETF 0.18 / 0.01 → 0.409008 / 0.045; inverse 0.5 → 0.259589", () => {
    expect(oetf709(0.18)).toBeCloseTo(0.409008, 6);
    expect(oetf709(0.01)).toBeCloseTo(0.045, 12);
    expect(oetf709Inverse(0.5)).toBeCloseTo(0.259589, 6);
  });

  it("BT.709 discontinuity: the window [0.08100, 0.08125) does not round-trip, and the note says so", () => {
    expect(oetf709(0.018) - 4.5 * 0.018).toBeCloseTo(0.000248, 6);
    expect(oetf709Inverse(0.0811)).toBeLessThan(0.018);
    expect(ok(transfer("bt709", "toLight", 0.0811)).notes.join(" ")).toMatch(/never outputs/);
    for (const L of [0, 0.001, 0.0179, 0.018, 0.02, 0.18, 0.5, 1]) expect(oetf709Inverse(oetf709(L))).toBeCloseTo(L, 12);
  });

  it("BT.1886 EOTF 0.5: Lb 0 → 18.94646, Lb 0.1 → 21.60491 cd/m²; inverse round-trips", () => {
    expect(eotf1886(0.5, 100, 0)).toBeCloseTo(18.94646, 5);
    expect(eotf1886(0.5, 100, 0.1)).toBeCloseTo(21.60491, 5);
    expect(eotf1886Inverse(eotf1886(0.37, 100, 0.1), 100, 0.1)).toBeCloseTo(0.37, 12);
  });

  it("sRGB EOTF 0.5 / 0.02 → 0.2140411 / 0.0015480; inverse 0.18 → 0.4613561", () => {
    expect(eotfSrgb(0.5)).toBeCloseTo(0.2140411, 7);
    expect(eotfSrgb(0.02)).toBeCloseTo(0.001548, 7);
    expect(eotfSrgbInverse(0.18)).toBeCloseTo(0.4613561, 7);
  });

  it("PQ inverse 100 / 203 / 1000 nit → 0.5080784 / 0.5806889 / 0.7518271; PQ 0.5 → 92.24571", () => {
    expect(nitsToPq(100)).toBeCloseTo(0.5080784, 7);
    expect(nitsToPq(203)).toBeCloseTo(0.5806889, 7);
    expect(nitsToPq(1000)).toBeCloseTo(0.7518271, 7);
    expect(pqToNits(0.5)).toBeCloseTo(92.24571, 4);
  });

  it("HLG OETF 1/12 / 0.5 / 1 → 0.5 / 0.8716435 / 0.999999995; inverse 0.75 → 0.2649626", () => {
    expect(hlgOetf(1 / 12)).toBeCloseTo(0.5, 12);
    expect(hlgOetf(0.5)).toBeCloseTo(0.8716435, 7);
    expect(hlgOetf(1)).toBeCloseTo(0.999999995, 9);
    expect(hlgOetf(1)).not.toBe(1);
    expect(hlgOetfInverse(0.75)).toBeCloseTo(0.2649626, 7);
  });

  it("HLG constants [P] BT.2100 Table 5", () => {
    expect(HLG_A).toBe(0.17883277);
    expect(HLG_B).toBeCloseTo(0.28466892, 12);
    expect(HLG_C).toBeCloseTo(0.559910729529562, 14);
  });

  it("transfer(): says 709 is an OETF, refuses out-of-domain inputs by name, gives figure data", () => {
    const r = ok(transfer("bt709", "toLight", 0.5));
    expect(r.outputIs).toMatch(/SCENE light/);
    expect(r.notes.join(" ")).toMatch(/BT\.1886/);
    expect(r.figure.curve).toHaveLength(101);
    expect(r.figure.compare).toHaveLength(3);
    expect(err(transfer("pq", "toSignal", 12000))).toMatch(/0 to 10000/);
    expect(err(transfer("srgb", "toLight", 1.2))).toMatch(/0 to 1/);
    expect(err(transfer("bt1886", "toLight", 0.5, { Lw: 100, Lb: 100 }))).toMatch(/above a black level/);
    expect(ok(transfer("pq", "toLight", 0.5)).figure.logY).toBe(true);
  });

  it("figure data is drawable: log curves strictly positive, zero marks null, BT.1886 normalised to white", () => {
    for (const c of ["pq", "hlg"] as const) {
      for (const v of [0, 0.5, 1]) {
        const r = ok(transfer(c, "toLight", v));
        for (const p of r.figure.curve) expect(Number.isFinite(p.y) && p.y > 0).toBe(true);
        if (v === 0) expect(r.figure.mark).toBeNull();
        else expect(r.figure.mark!.y).toBeGreaterThan(0);
      }
    }
    const b = ok(transfer("bt1886", "toLight", 0.5, { Lw: 100, Lb: 0 }));
    expect(b.output).toBeCloseTo(18.94646, 5); // cd/m² in the result
    expect(b.figure.mark!.y).toBeCloseTo(0.1894646, 7); // normalised in the figure
    expect(Math.max(...b.figure.curve.map((p) => p.y))).toBeCloseTo(1, 12);
  });
});

describe("code values — §D2 [P] BT.2100 Table 9 / BT.709 item 6.10", () => {
  it("narrow 10-bit Y′ at 0 / 0.5 / 1 → 64 / 502 / 940; 8-bit white 235; 12-bit 3760", () => {
    expect(ok(codeValue(0, 10, "narrow")).code).toBe(64);
    expect(ok(codeValue(0.5, 10, "narrow")).code).toBe(502);
    expect(ok(codeValue(1, 10, "narrow")).code).toBe(940);
    expect(ok(codeValue(1, 8, "narrow")).code).toBe(235);
    expect(ok(codeValue(1, 12, "narrow")).code).toBe(3760);
  });

  it("narrow 10-bit chroma at 0 / +0.5 → 512 / 960", () => {
    expect(ok(codeValue(0, 10, "narrow", "chroma")).code).toBe(512);
    expect(ok(codeValue(0.5, 10, "narrow", "chroma")).code).toBe(960);
  });

  it("full-range chroma stays inside the word (ITU-T H.273 Clip1): +0.5 → 2ⁿ − 1, −0.5 → 1, 0 → 2ⁿ⁻¹", () => {
    for (const [n, top, mid] of [[8, 255, 128], [10, 1023, 512], [12, 4095, 2048]]) {
      const hi = ok(codeValue(0.5, n, "full", "chroma"));
      expect(hi.code).toBe(top);
      expect(hi.nominalMax).toBe(top);
      expect(hi.notes.join(" ")).toMatch(/Clip1/);
      expect(ok(codeValue(-0.5, n, "full", "chroma")).code).toBe(1);
      expect(ok(codeValue(0, n, "full", "chroma")).code).toBe(mid);
      expect(hi.notes[0]).toContain(`1 to ${top}`);
    }
  });

  it("every emitted formula line is typeset — no ASCII '^'", () => {
    for (const c of ["bt709", "bt1886", "srgb", "pq", "hlg"] as const) {
      expect(ok(transfer(c, "toLight", 0.5)).formula).not.toMatch(/\^/);
    }
    for (const r of ["narrow", "full"] as const) {
      for (const comp of ["luma", "chroma"] as const) {
        const c = ok(codeValue(0, 10, r, comp));
        expect(c.formula).not.toMatch(/\^/);
        for (const t of c.notes) expect(t).not.toMatch(/\^/);
      }
    }
  });

  it("full range 10-bit white is 1023; out-of-range signals refused", () => {
    expect(ok(codeValue(1, 10, "full")).code).toBe(1023);
    expect(err(codeValue(1.1, 10, "narrow"))).toMatch(/0 to 1/);
    expect(err(codeValue(0, 9, "narrow"))).toMatch(/8, 10, 12 or 16/);
  });
});

describe("display contract — no float noise in notes", () => {
  it("notes carry no long decimals or exponent notation", () => {
    const texts: string[] = [];
    const add = (r: { ok: boolean; notes?: string[]; error?: string }) => texts.push(...(r.ok ? r.notes ?? [] : [r.error!]));
    for (const fps of [23.976, 24, 25, 29.97, 30000 / 1001, 50, 59.94, 60, 48]) {
      add(bitrate(1920, 1080, fps, 10, "4:2:2", 1));
      add(bitrate(1280, 720, fps, 8, "4:2:0", 1));
      add(latencyBudget([{ name: "x", ms: 7 * (1000 / fps) }], fps));
    }
    for (const r of ["23.976", "29.97", "59.94", 25]) add(rateFacts(r, 44100));
    add(pulldown(24, "29.97"));
    add(pulldown("23.976", 25));
    add(shutter({ angleDeg: 172.8 }, "29.97"));
    add(aspect({ width: 1366, height: 768, frame: "1920x1080", content: 2.39 }));
    add(transfer("bt709", "toLight", 0.0811));
    for (const t of texts) {
      expect(t).not.toMatch(/\d\.\d{10,}/);
      expect(t).not.toMatch(/\de[+-]\d/);
      expect(t).not.toMatch(/NaN|undefined/);
    }
  });
});
