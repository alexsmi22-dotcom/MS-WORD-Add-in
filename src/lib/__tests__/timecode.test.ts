// SMPTE ST 12-1 timecode — §D2 acceptance values (docs/SCOPE-AUDIO-VIDEO-2026-10.md).
// Oracle classes: [P] the ST 12-1 drop rule, [X] exact Fraction arithmetic.
import {
  tcToFrames,
  framesToTc,
  tcDuration,
  realTimeOf,
  parseRate,
  parseTimecode,
  framesPerDay,
  driftFigure,
  rat,
  ratCmp,
  ratToDecimal,
  ratLabel,
  clockText,
  FrameRate,
} from "../timecode";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};
const err = (r: { ok: boolean; error?: string }): string => {
  if (r.ok) throw new Error("expected a refusal");
  return (r as { error: string }).error;
};
const rate = (s: string | number): FrameRate => ok(parseRate(s));

describe("§D2 drop-frame landmarks [P] ST 12-1 rule", () => {
  it("29.97 DF frame 1799 / 1800 → 00:00:59;29 / 00:01:00;02", () => {
    expect(ok(framesToTc(1799, "29.97", true)).label).toBe("00:00:59;29");
    expect(ok(framesToTc(1800, "29.97", true)).label).toBe("00:01:00;02");
  });

  it("00:10:00;00 / 01:00:00;00 at 29.97 DF → 17982 / 107892", () => {
    expect(ok(tcToFrames("00:10:00;00", "29.97")).frames).toBe(17982);
    expect(ok(tcToFrames("01:00:00;00", "29.97")).frames).toBe(107892);
  });

  it("59.94 DF 00:01:00;04 / 01:00:00;00 → 3600 / 215784 (four labels dropped)", () => {
    expect(ok(tcToFrames("00:01:00;04", "59.94")).frames).toBe(3600);
    expect(ok(tcToFrames("01:00:00;00", "59.94")).frames).toBe(215784);
  });

  it("29.97 NDF 01:00:00:00 = 108000 frames = 3603.6 s real (+3.6 s drift) [X]", () => {
    const r = ok(tcToFrames("01:00:00:00", "29.97", false));
    expect(r.frames).toBe(108000);
    expect(ratCmp(r.realSeconds, rat(36036, 10))).toBe(0);
    const t = ok(realTimeOf(108000, "29.97"));
    expect(ratCmp(t.ndfDriftSeconds, rat(36, 10))).toBe(0);
  });

  it("29.97 DF 01:00:00;00 real time = 3599.9964 s exactly [X]", () => {
    const r = ok(tcToFrames("01:00:00;00", "29.97"));
    expect(ratToDecimal(r.realSeconds).text).toBe("3599.9964");
    expect(ratToDecimal(r.realSeconds).exact).toBe(true);
  });

  it("23.976 01:00:00:00 = 86400 frames = 3603.6 s [X]", () => {
    const r = ok(tcToFrames("01:00:00:00", "23.976"));
    expect(r.frames).toBe(86400);
    expect(ratToDecimal(r.realSeconds).text).toBe("3603.6");
  });

  it("REFUSES 00:01:00;00 at 29.97 DF — the label does not exist (the timecode library returns 1798)", () => {
    const e = err(tcToFrames("00:01:00;00", "29.97"));
    expect(e).toMatch(/does not exist/);
    expect(e).toMatch(/00:00:59;29/);
    expect(e).toMatch(/00:01:00;02/);
    expect(err(tcToFrames("00:01:00;01", "29.97", true))).toMatch(/does not exist/);
  });

  it("refuses ; at a non-DF rate and DF at 23.976 / 24 / 25 / 30", () => {
    expect(err(tcToFrames("00:00:10;00", 25))).toMatch(/drop-frame does not exist at 25/);
    for (const r of ["23.976", "24", "25", "30", "50", "60"]) {
      expect(err(tcToFrames("00:00:10:00", r, true))).toMatch(/only for the 1000\/1001 rates of 30 and 60/);
    }
  });

  it("refuses a frame field at or above the nominal rate", () => {
    expect(err(tcToFrames("00:00:00:30", "29.97", false))).toMatch(/Frame 30 does not exist/);
    expect(err(tcToFrames("00:00:00:25", 25))).toMatch(/00–24/);
    expect(ok(tcToFrames("00:00:00:59", "59.94", false)).frames).toBe(59);
  });
});

describe("rates", () => {
  it("snaps 23.976 / 23.98 / 29.97 / 59.94 to n·1000/1001 and SAYS so", () => {
    for (const [t, n] of [["23.976", 24], ["23.98", 24], ["29.97", 30], ["59.94", 60]] as [string, number][]) {
      const r = rate(t);
      expect(ratCmp(r.fps, rat(n * 1000, 1001))).toBe(0);
      expect(r.snapNote).toMatch(/1000\/1001/);
    }
    expect(rate("30000/1001").snapNote).toBeNull();
    expect(rate(30000 / 1001).snapNote).not.toBeNull(); // a float is a decimal, snapped and reported
  });

  it("reads 29.97 DF / 59.94 NDF / fps suffixes", () => {
    expect(rate("29.97 DF").dfInText).toBe(true);
    expect(rate("59.94 NDF").dfInText).toBe(false);
    expect(rate("25 fps").id).toBe("25");
    expect(rate("29.97DF").dfInText).toBe(true);
  });

  it("refuses near misses by name", () => {
    expect(err(parseRate(29.96))).toMatch(/not a timecode rate/);
    expect(err(parseRate("30.5"))).toMatch(/23\.976, 24, 25, 29\.97, 30, 50, 59\.94 and 60/);
    expect(err(parseRate("48"))).toMatch(/not a timecode rate/);
    expect(err(parseRate(0))).toMatch(/greater than zero/);
  });
});

describe("conversions", () => {
  it("default 00:10:00;00 parses verbatim", () => {
    expect(ok(tcToFrames("00:10:00;00", "29.97 DF")).label).toBe("00:10:00;00");
  });

  it("NDF at integer rates is plain arithmetic", () => {
    expect(ok(tcToFrames("01:02:03:04", 25)).frames).toBe((3600 + 120 + 3) * 25 + 4);
    expect(ok(framesToTc(93079, 25)).label).toBe("01:02:03:04");
  });

  it("frame numbers are 0-based and said so", () => {
    const r = ok(tcToFrames("00:00:00:00", 24));
    expect(r.frames).toBe(0);
    expect(r.notes.join(" ")).toMatch(/0-based/);
  });

  it("duration A→B in frames, seconds and label", () => {
    const d = ok(tcDuration("00:00:59;29", "00:01:00;02", "29.97"));
    expect(d.frames).toBe(1);
    expect(ratCmp(d.seconds, rat(1001, 30000))).toBe(0);
    const h = ok(tcDuration("00:00:00;00", "01:00:00;00", "29.97"));
    expect(h.frames).toBe(107892);
    expect(h.durationLabel).toBe("01:00:00;00");
  });

  it("a backwards duration is negative and offers the through-midnight span", () => {
    const d = ok(tcDuration("23:59:59:00", "00:00:01:00", 25));
    expect(d.frames).toBe(-(86398 * 25));
    expect(d.durationLabel.startsWith("−")).toBe(true);
    expect(d.acrossMidnightFrames).toBe(50);
  });

  it("24-hour day lengths [X]", () => {
    expect(framesPerDay(rate("29.97"), true)).toBe(2589408);
    expect(framesPerDay(rate("59.94"), true)).toBe(5178816);
    expect(framesPerDay(rate("29.97"), false)).toBe(2592000);
  });

  it("realTimeOf gives an exact clock", () => {
    expect(ok(realTimeOf(108000, "29.97")).clock).toBe("1:00:03.6");
    expect(clockText(rat(1001, 30))).toBe("0:00:33.366666…");
    expect(ratLabel(rat(1001, 30))).toBe("1001/30 (33.366666…)");
  });
});

describe("drift figure", () => {
  it("NDF falls behind by 3.6 s in an hour; DF stays within a few frames", () => {
    const f = ok(driftFigure("29.97", 60));
    const lastNdf = f.ndf[f.ndf.length - 1];
    expect(lastNdf.driftS).toBeCloseTo(-3.6, 1);
    for (const p of f.df) expect(Math.abs(p.driftS)).toBeLessThan(4 / 30);
    expect(f.df.length).toBeGreaterThan(f.ndf.length / 2);
  });

  it("an integer rate has no drift", () => {
    const f = ok(driftFigure(25, 10));
    for (const p of f.ndf) expect(Math.abs(p.driftS)).toBeLessThan(1e-9);
    expect(f.df).toEqual([]);
  });

  it("marks the entered frame", () => {
    const f = ok(driftFigure("29.97", 60, 17982));
    expect(f.mark!.realMin).toBeCloseTo(17982 * 1001 / 30000 / 60, 9);
    expect(f.mark!.dfDriftS).not.toBeNull();
  });
});

describe("label parsing", () => {
  it("accepts HH:MM:SS:FF and HH:MM:SS;FF, refuses junk", () => {
    expect(parseTimecode("01:02:03:04")).toMatchObject({ h: 1, m: 2, s: 3, f: 4, semicolon: false });
    expect(parseTimecode("01:02:03;04")).toMatchObject({ semicolon: true });
    expect(err(parseTimecode("1:2:3:4") as { ok: false; error: string })).toMatch(/not a timecode/);
  });
});
