import {
  bitrate,
  bitsPerPixel,
  resolution,
  hdrRange,
  psnr,
  streamBuffer,
  latencyBudget,
  pqToNits,
  nitsToPq,
  PQ_PEAK_NITS,
} from "../video";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("chroma subsampling", () => {
  it("4:2:0 IS A 50% REDUCTION, not 25%", () => {
    // The commonest arithmetic error in the subject: it halves chroma both
    // horizontally AND vertically.
    expect(bitsPerPixel(8, "4:2:0") / bitsPerPixel(8, "4:4:4")).toBeCloseTo(0.5, 12);
  });

  it("4:2:2 is a third less than 4:4:4", () => {
    expect(bitsPerPixel(8, "4:2:2") / bitsPerPixel(8, "4:4:4")).toBeCloseTo(2 / 3, 12);
  });

  it("scales with bit depth", () => {
    expect(bitsPerPixel(10, "4:2:0")).toBeCloseTo(15, 12);
    expect(bitsPerPixel(8, "4:4:4")).toBe(24);
  });
});

describe("bitrate", () => {
  it("1080p25 8-bit 4:2:0 uncompressed is 622.08 Mbit/s", () => {
    const r = ok(bitrate(1920, 1080, 25, 8, "4:2:0", 1));
    expect(r.uncompressedBps / 1e6).toBeCloseTo(622.08, 2);
    expect(r.bitsPerPixel).toBe(12);
  });

  it("compression divides the raw rate", () => {
    const r = ok(bitrate(1920, 1080, 25, 8, "4:2:0", 100));
    expect(r.compressedBps).toBeCloseTo(r.uncompressedBps / 100, 6);
  });

  it("file size follows from the compressed rate and duration", () => {
    const r = ok(bitrate(1920, 1080, 25, 8, "4:2:0", 100, 60));
    expect(r.sizeBytes).toBeCloseTo((r.compressedBps * 60) / 8, 3);
  });

  it("refuses a compression ratio below 1 — that would make it bigger", () => {
    const r = bitrate(1920, 1080, 25, 8, "4:2:0", 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/LARGER/);
  });

  it("says the compression ratio is the user's input", () => {
    expect(ok(bitrate(1920, 1080, 25, 8, "4:2:0", 50)).notes.join(" ")).toMatch(/YOUR input/);
  });

  it("refuses fractional pixel dimensions", () => {
    expect(bitrate(1920.5, 1080, 25, 8, "4:2:0").ok).toBe(false);
  });
});

describe("resolution and viewing geometry", () => {
  it("reduces the aspect ratio to whole numbers", () => {
    expect(ok(resolution(1920, 1080)).aspectLabel).toBe("16:9");
    expect(ok(resolution(3840, 2160)).aspectLabel).toBe("16:9");
    expect(ok(resolution(2048, 1080)).aspectLabel).toBe("256:135"); // DCI 2K
  });

  it("counts pixels", () => {
    expect(ok(resolution(3840, 2160)).megapixels).toBeCloseTo(8.2944, 4);
  });

  it("PPI follows the diagonal in pixels over the diagonal in inches", () => {
    const r = ok(resolution(3840, 2160, 55));
    expect(r.ppi!).toBeCloseTo(Math.hypot(3840, 2160) / 55, 6);
    expect(r.ppi!).toBeCloseTo(80.1, 1);
  });

  it("a denser panel must be viewed closer before the grid disappears", () => {
    const tv = ok(resolution(3840, 2160, 55));
    const phone = ok(resolution(2532, 1170, 6.1));
    expect(phone.ppi!).toBeGreaterThan(tv.ppi!);
    expect(phone.retinaDistanceM!).toBeLessThan(tv.retinaDistanceM!);
  });

  it("says the eye is the limit", () => {
    expect(ok(resolution(3840, 2160, 55)).notes.join(" ")).toMatch(/eye is the limit/);
  });
});

describe("PQ / ST 2084", () => {
  it("PQ(1) IS EXACTLY THE 10000 NIT PEAK — the property that validates the constants", () => {
    // Verified by behaviour rather than by comparing digits: wrong constants
    // fail this immediately.
    expect(pqToNits(1)).toBeCloseTo(PQ_PEAK_NITS, 6);
    expect(pqToNits(0)).toBe(0);
  });

  it("round-trips across the whole range", () => {
    for (const nits of [0.001, 0.1, 1, 10, 100, 203, 1000, 4000, 10000]) {
      expect(pqToNits(nitsToPq(nits))).toBeCloseTo(nits, 6);
    }
  });

  it("is monotonic", () => {
    let prev = -1;
    for (let s = 0; s <= 1; s += 0.02) {
      const n = pqToNits(s);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it("allocates most of its code range to low luminance, as a perceptual curve should", () => {
    // Half the code values cover well under half the nits.
    expect(pqToNits(0.5)).toBeLessThan(PQ_PEAK_NITS * 0.02);
  });
});

describe("HDR range", () => {
  it("contrast is peak over black, and stops are its log2", () => {
    const r = ok(hdrRange(1000, 0.05));
    expect(r.contrastRatio).toBeCloseTo(20000, 6);
    expect(r.stops).toBeCloseTo(Math.log2(20000), 9);
  });

  it("a zero black level gives infinite contrast, and says why", () => {
    const r = ok(hdrRange(1000, 0));
    expect(r.contrastRatio).toBe(Infinity);
    expect(r.notes.join(" ")).toMatch(/self-emissive|infinite/i);
  });

  it("BLACK dominates: halving black doubles contrast, as does doubling peak", () => {
    const base = ok(hdrRange(1000, 0.1));
    expect(ok(hdrRange(1000, 0.05)).contrastRatio).toBeCloseTo(base.contrastRatio * 2, 6);
    expect(ok(hdrRange(2000, 0.1)).contrastRatio).toBeCloseTo(base.contrastRatio * 2, 6);
  });

  it("refuses a peak above the PQ ceiling and a black at or above peak", () => {
    expect(hdrRange(20000, 0.1).ok).toBe(false);
    expect(hdrRange(100, 100).ok).toBe(false);
    expect(hdrRange(100, 200).ok).toBe(false);
  });

  it("says PQ is an absolute curve", () => {
    expect(ok(hdrRange(1000, 0.05)).notes.join(" ")).toMatch(/ABSOLUTE curve/);
  });
});

describe("PSNR", () => {
  it("follows 10 log10(MAX^2 / MSE)", () => {
    const r = ok(psnr(100, 8));
    expect(r.psnrDb).toBeCloseTo(10 * Math.log10((255 * 255) / 100), 9);
    expect(r.psnrDb).toBeCloseTo(28.13, 2);
  });

  it("scales with bit depth through MAX", () => {
    expect(ok(psnr(100, 10)).maxValue).toBe(1023);
    expect(ok(psnr(100, 10)).psnrDb).toBeGreaterThan(ok(psnr(100, 8)).psnrDb);
  });

  it("lower error is higher PSNR", () => {
    expect(ok(psnr(10, 8)).psnrDb).toBeGreaterThan(ok(psnr(100, 8)).psnrDb);
  });

  it("refuses identical images rather than reporting infinity", () => {
    const r = psnr(0, 8);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/identical/);
  });

  it("always says it is only comparable within one clip", () => {
    expect(ok(psnr(100, 8)).notes.join(" ")).toMatch(/WITHIN one piece of content/);
  });
});

describe("stream buffering", () => {
  it("buffer duration is its size over the stream rate", () => {
    const r = ok(streamBuffer(5e6, 8e6, 5e6));
    expect(r.bufferSeconds).toBeCloseTo(8, 6); // 40 Mbit / 5 Mbit/s
  });

  it("STARTUP USES THE SURPLUS, not the whole bandwidth", () => {
    // Playback drains at the stream rate while the buffer fills.
    const r = ok(streamBuffer(5e6, 8e6, 5e6));
    expect(r.startupDelayS).toBeCloseTo(40 / 3, 6);
    expect(r.startupDelayS).toBeGreaterThan(r.bufferSeconds); // surplus < rate here
  });

  it("bandwidth at or below the stream rate never fills — and says so", () => {
    const r = ok(streamBuffer(5e6, 5e6, 5e6));
    expect(r.startupDelayS).toBe(Infinity);
    expect(r.notes.join(" ")).toMatch(/bitrate problem, not a buffer problem/);
  });

  it("more headroom means a faster start", () => {
    expect(ok(streamBuffer(5e6, 20e6, 5e6)).startupDelayS).toBeLessThan(
      ok(streamBuffer(5e6, 8e6, 5e6)).startupDelayS,
    );
  });
});

describe("latency budget", () => {
  const stages = [
    { name: "capture", ms: 5 },
    { name: "encode", ms: 20 },
    { name: "network", ms: 30 },
    { name: "decode", ms: 8 },
  ];

  it("sums the stages and rounds UP to a refresh boundary", () => {
    const r = ok(latencyBudget(stages, 60));
    expect(r.totalMs).toBe(63);
    expect(r.quantisedMs).toBeCloseTo(66.667, 3); // 4 frames at 16.667 ms
    expect(r.frames).toBe(4);
  });

  it("SHAVING TIME CHANGES NOTHING INSIDE ONE INTERVAL — the whole point", () => {
    const faster = stages.map((s) => (s.name === "encode" ? { ...s, ms: 15 } : s));
    const a = ok(latencyBudget(stages, 60));
    const b = ok(latencyBudget(faster, 60));
    expect(b.totalMs).toBeLessThan(a.totalMs); // 58 < 63
    expect(b.quantisedMs).toBeCloseTo(a.quantisedMs, 6); // but both land in frame 4
  });

  it("crossing a boundary does change it", () => {
    const muchFaster = stages.map((s) => (s.name === "network" ? { ...s, ms: 10 } : s));
    expect(ok(latencyBudget(muchFaster, 60)).frames).toBeLessThan(ok(latencyBudget(stages, 60)).frames);
  });

  it("names the largest stage, where effort actually pays", () => {
    expect(ok(latencyBudget(stages, 60)).worst.name).toBe("network");
  });

  it("refuses empty or negative stages", () => {
    expect(latencyBudget([], 60).ok).toBe(false);
    expect(latencyBudget([{ name: "x", ms: -1 }], 60).ok).toBe(false);
  });
});
