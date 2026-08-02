import {
  quantisation,
  toDb,
  fromDb,
  splAtDistance,
  sumIncoherent,
  reverbTime,
  roomModes,
  combFilter,
  SPEED_OF_SOUND_20C,
  P_REF_SPL,
} from "../audio";

const ok = <T extends { ok: boolean }>(r: T | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error((r as { error: string }).error);
  return r as T;
};

describe("quantisation", () => {
  it("16-bit gives the canonical 98.08 dB", () => {
    const r = ok(quantisation(16));
    expect(r.snrDb).toBeCloseTo(98.08, 2);
    expect(r.levels).toBe(65536);
  });

  it("each bit is worth 6.02 dB", () => {
    expect(ok(quantisation(17)).snrDb - ok(quantisation(16)).snrDb).toBeCloseTo(6.02, 6);
  });

  it("the 1.76 dB term is present, since dropping it is the common error", () => {
    // 6.02n alone would give 96.32 dB for 16 bits.
    expect(ok(quantisation(16)).snrDb).toBeGreaterThan(6.02 * 16 + 1.7);
  });

  it("CD audio's uncompressed rate is 1.411 Mbit/s", () => {
    const r = ok(quantisation(16, undefined, 44100, 2));
    expect(r.bitRate! / 1e6).toBeCloseTo(1.4112, 4);
  });

  it("LSB scales with full scale", () => {
    expect(ok(quantisation(8, 1)).lsbVolts).toBeCloseTo(1 / 256, 12);
  });

  it("always says the figure assumes a full-scale signal", () => {
    expect(ok(quantisation(16)).notes.join(" ")).toMatch(/FULL-SCALE/);
  });

  it("refuses a non-integer or out-of-range depth", () => {
    for (const b of [0, -1, 1.5, 65, NaN]) expect(quantisation(b).ok).toBe(false);
  });
});

describe("decibels: both conventions, always", () => {
  it("doubling power is 3.01 dB; doubling a field quantity is 6.02", () => {
    expect(ok(toDb(2, "power")).db).toBeCloseTo(3.0103, 4);
    expect(ok(toDb(2, "field")).db).toBeCloseTo(6.0206, 4);
  });

  it("the other convention is always reported, to make the error visible", () => {
    expect(ok(toDb(2, "power")).dbIfOtherConvention).toBeCloseTo(6.0206, 4);
    expect(ok(toDb(2, "field")).dbIfOtherConvention).toBeCloseTo(3.0103, 4);
  });

  it("round-trips", () => {
    for (const q of ["power", "field"] as const) {
      expect(ok(fromDb(ok(toDb(7.5, q)).db, q)).ratio).toBeCloseTo(7.5, 9);
    }
  });

  it("a unity ratio is 0 dB on either basis", () => {
    expect(ok(toDb(1, "power")).db).toBeCloseTo(0, 12);
    expect(ok(toDb(1, "field")).db).toBeCloseTo(0, 12);
  });

  it("refuses a zero or negative ratio", () => {
    expect(toDb(0, "power").ok).toBe(false);
    expect(toDb(-1, "field").ok).toBe(false);
  });
});

describe("SPL and distance", () => {
  it("doubling the distance is -6.02 dB", () => {
    const r = ok(splAtDistance(100, 1, 2));
    expect(r.changeDb).toBeCloseTo(-6.0206, 4);
    expect(r.atDistanceDb).toBeCloseTo(93.98, 2);
  });

  it("ten times the distance is -20 dB", () => {
    expect(ok(splAtDistance(100, 1, 10)).changeDb).toBeCloseTo(-20, 9);
  });

  it("halving the distance is +6 dB", () => {
    expect(ok(splAtDistance(90, 2, 1)).changeDb).toBeCloseTo(6.0206, 4);
  });

  it("1 Pa is 93.979 dB SPL, and 94 dB is the ROUNDED convention", () => {
    // Calibrators are labelled "94 dB", which is 1.0024 Pa rather than exactly
    // 1 Pa. Pinning the exact relation rather than the rounded label, because
    // asserting 94 dB = 1 Pa to three decimals would be pinning the rounding.
    const exact = 20 * Math.log10(1 / P_REF_SPL);
    expect(exact).toBeCloseTo(93.979, 3);
    expect(ok(splAtDistance(exact, 1, 1)).pressurePa).toBeCloseTo(1, 9);
    expect(ok(splAtDistance(94, 1, 1)).pressurePa).toBeCloseTo(1.0024, 4);
    expect(P_REF_SPL).toBe(20e-6);
  });

  it("says it is free-field only", () => {
    expect(ok(splAtDistance(100, 1, 2)).notes.join(" ")).toMatch(/FREE FIELD/i);
  });
});

describe("summing incoherent sources", () => {
  it("TWO identical sources give +3 dB, not +6", () => {
    const r = ok(sumIncoherent([80, 80]));
    expect(r.totalDb).toBeCloseTo(83.01, 2);
    expect(r.aboveLoudestDb).toBeCloseTo(3.01, 2);
  });

  it("ten identical sources give +10 dB", () => {
    expect(ok(sumIncoherent(new Array(10).fill(70))).aboveLoudestDb).toBeCloseTo(10, 6);
  });

  it("a source 10 dB down barely contributes", () => {
    expect(ok(sumIncoherent([80, 70])).aboveLoudestDb).toBeLessThan(0.5);
  });

  it("one source sums to itself", () => {
    expect(ok(sumIncoherent([65])).totalDb).toBeCloseTo(65, 9);
  });

  it("names the coherent case as the thing this is not", () => {
    expect(ok(sumIncoherent([80, 80])).notes.join(" ")).toMatch(/COHERENT/);
  });
});

describe("reverberation", () => {
  it("Sabine follows 0.161 V / A", () => {
    const r = ok(reverbTime(200, 240, 0.2));
    expect(r.sabineS).toBeCloseTo((0.161 * 200) / (240 * 0.2), 6);
  });

  it("EYRING IS ALWAYS SHORTER, and they diverge as absorption rises", () => {
    const low = ok(reverbTime(200, 240, 0.05));
    const high = ok(reverbTime(200, 240, 0.5));
    expect(low.eyringS).toBeLessThan(low.sabineS);
    expect(high.eyringS).toBeLessThan(high.sabineS);
    const lowGap = (low.sabineS - low.eyringS) / low.eyringS;
    const highGap = (high.sabineS - high.eyringS) / high.eyringS;
    expect(highGap).toBeGreaterThan(lowGap * 3);
  });

  it("they agree closely while absorption is small", () => {
    const r = ok(reverbTime(300, 300, 0.05));
    expect(Math.abs(r.sabineS - r.eyringS) / r.eyringS).toBeLessThan(0.03);
  });

  it("warns to use Eyring once absorption is high", () => {
    expect(ok(reverbTime(200, 240, 0.4)).notes.join(" ")).toMatch(/use Eyring/);
  });

  it("refuses an absorption coefficient of 1, which has nothing to reverberate", () => {
    expect(reverbTime(200, 240, 1).ok).toBe(false);
    expect(reverbTime(200, 240, 0).ok).toBe(false);
  });

  it("says the coefficients are an input and vary by band", () => {
    expect(ok(reverbTime(200, 240, 0.2)).notes.join(" ")).toMatch(/MEASURED properties/);
  });
});

describe("room modes", () => {
  it("the first axial mode of a 5 m length is c/2L", () => {
    const r = ok(roomModes(5, 4, 2.5, 120));
    expect(r.modes[0].frequency).toBeCloseTo(SPEED_OF_SOUND_20C / 10, 6);
    expect(r.modes[0].kind).toBe("axial");
    expect(r.modes[0].order).toEqual([1, 0, 0]);
  });

  it("classifies axial, tangential and oblique by non-zero orders", () => {
    const r = ok(roomModes(5, 4, 2.5, 300));
    for (const m of r.modes) {
      const nz = m.order.filter((n) => n > 0).length;
      expect(m.kind).toBe(nz === 1 ? "axial" : nz === 2 ? "tangential" : "oblique");
    }
    expect(r.modes.some((m) => m.kind === "tangential")).toBe(true);
  });

  it("is sorted and bounded by the frequency ceiling", () => {
    const r = ok(roomModes(5, 4, 2.5, 150));
    for (let i = 1; i < r.modes.length; i++) {
      expect(r.modes[i].frequency).toBeGreaterThanOrEqual(r.modes[i - 1].frequency);
    }
    for (const m of r.modes) expect(m.frequency).toBeLessThanOrEqual(150);
  });

  it("a cube stacks its modes, which is why ratios matter", () => {
    const cube = ok(roomModes(4, 4, 4, 150));
    const first3 = cube.modes.slice(0, 3).map((m) => m.frequency);
    expect(first3[0]).toBeCloseTo(first3[1], 6);
    expect(first3[1]).toBeCloseTo(first3[2], 6);
  });

  it("says axial modes dominate", () => {
    expect(ok(roomModes(5, 4, 2.5)).notes.join(" ")).toMatch(/Axial modes/);
  });
});

describe("comb filtering", () => {
  it("1 ms notches at 500 Hz and every odd multiple", () => {
    const r = ok(combFilter(1));
    expect(r.firstNotchHz).toBeCloseTo(500, 9);
    expect(r.notches.slice(0, 3)).toEqual([500, 1500, 2500]);
  });

  it("peaks fall at every multiple of 1/t", () => {
    expect(ok(combFilter(1)).peaks.slice(0, 3)).toEqual([1000, 2000, 3000]);
  });

  it("a path difference converts to the same answer as its delay", () => {
    const byPath = ok(combFilter(undefined, SPEED_OF_SOUND_20C / 1000));
    expect(byPath.delayMs).toBeCloseTo(1, 9);
    expect(byPath.firstNotchHz).toBeCloseTo(500, 6);
  });

  it("requires exactly one of delay or path difference", () => {
    expect(combFilter().ok).toBe(false);
    expect(combFilter(1, 0.343).ok).toBe(false);
  });

  it("says EQ cannot fix it", () => {
    expect(ok(combFilter(1)).notes.join(" ")).toMatch(/cannot fix/i);
  });
});
