// Computation tests. Every bound is checked against its own definition or a
// closed form, never against a remembered decimal.

import {
  parallelSpeedup,
  shannonEntropy,
  binaryEntropyBits,
  channelCapacity,
  bscCapacity,
  collisionProbability,
  floatPrecision,
  runtimeScaling,
} from "../computation";

describe("parallel speedup", () => {
  test("Amdahl's ceiling is 1/(1-p) and is approached from below", () => {
    const r = parallelSpeedup(0.9, 1e9)!;
    expect(r.amdahlCeiling).toBeCloseTo(10, 12);
    expect(r.amdahl).toBeLessThan(10);
    expect(r.amdahl).toBeGreaterThan(9.99);
  });

  test("a hand-worked case: 95% parallel on 8 cores", () => {
    const r = parallelSpeedup(0.95, 8)!;
    // 1/(0.05 + 0.95/8) = 1/0.16875 = 5.9259...
    expect(r.amdahl).toBeCloseTo(1 / (0.05 + 0.95 / 8), 12);
    expect(r.amdahl).toBeCloseTo(5.926, 3);
    expect(r.efficiency).toBeCloseTo(r.amdahl / 8, 12);
    // Gustafson on the same numbers: 0.05 + 0.95*8 = 7.65.
    expect(r.gustafson).toBeCloseTo(7.65, 12);
  });

  test("both laws agree at one processor, and only there", () => {
    for (const p of [0, 0.3, 0.7, 0.99]) {
      const one = parallelSpeedup(p, 1)!;
      expect(one.amdahl).toBeCloseTo(1, 12);
      expect(one.gustafson).toBeCloseTo(1, 12);
    }
    const many = parallelSpeedup(0.7, 16)!;
    expect(many.gustafson).toBeGreaterThan(many.amdahl);
  });

  test("a fully serial program never speeds up", () => {
    const r = parallelSpeedup(0, 1024)!;
    expect(r.amdahl).toBeCloseTo(1, 12);
    expect(r.gustafson).toBeCloseTo(1, 12);
    expect(r.amdahlCeiling).toBeCloseTo(1, 12);
  });

  test("a fully parallel program has no ceiling", () => {
    const r = parallelSpeedup(1, 64)!;
    expect(r.amdahl).toBeCloseTo(64, 12);
    expect(r.amdahlCeiling).toBe(Infinity);
  });

  test("the ceiling being below the core count is called out", () => {
    const r = parallelSpeedup(0.5, 100)!;
    expect(r.amdahlCeiling).toBeCloseTo(2, 12);
    expect(r.notes.join(" ")).toMatch(/BELOW the 100 processors/);
  });

  test("Karp-Flatt recovers the serial fraction from an ideal measurement", () => {
    // If the measured speedup IS Amdahl's, Karp-Flatt must return 1-p exactly.
    const p = 0.8;
    const n = 16;
    const ideal = 1 / (1 - p + p / n);
    const r = parallelSpeedup(p, n, ideal)!;
    expect(r.karpFlatt!).toBeCloseTo(1 - p, 10);
  });

  test("out-of-range inputs are refused", () => {
    expect(parallelSpeedup(-0.1, 4)).toBeNull();
    expect(parallelSpeedup(1.1, 4)).toBeNull();
    expect(parallelSpeedup(0.5, 0)).toBeNull();
    expect(parallelSpeedup(0.5, 4, 0)).toBeNull();
  });
});

describe("Shannon entropy", () => {
  test("a fair coin is exactly 1 bit and a fair die is log2(6)", () => {
    expect(shannonEntropy([0.5, 0.5])!.entropyBits).toBeCloseTo(1, 12);
    expect(shannonEntropy([1, 1, 1, 1, 1, 1])!.entropyBits).toBeCloseTo(Math.log2(6), 12);
  });

  test("a certain outcome carries zero information", () => {
    const r = shannonEntropy([1, 0, 0, 0])!;
    expect(r.entropyBits).toBeCloseTo(0, 12);
    expect(r.redundancy).toBeCloseTo(1, 12);
  });

  test("ZERO probabilities contribute zero, not NaN", () => {
    const r = shannonEntropy([0.5, 0.5, 0, 0])!;
    expect(Number.isNaN(r.entropyBits)).toBe(false);
    expect(r.entropyBits).toBeCloseTo(1, 12);
    expect(r.notes.join(" ")).toMatch(/zero probability/);
  });

  test("uniform maximises entropy — nothing beats log2(n)", () => {
    const n = 5;
    const uniform = shannonEntropy(new Array(n).fill(1))!;
    expect(uniform.entropyBits).toBeCloseTo(Math.log2(n), 12);
    for (const w of [[5, 1, 1, 1, 1], [2, 2, 1, 1, 1], [10, 1, 1, 1, 1]]) {
      expect(shannonEntropy(w)!.entropyBits).toBeLessThan(uniform.entropyBits + 1e-12);
    }
  });

  test("counts are normalised, and it says so", () => {
    const r = shannonEntropy([30, 30])!;
    expect(r.entropyBits).toBeCloseTo(1, 12);
    expect(r.normalised).toBe(true);
    expect(r.notes.join(" ")).toMatch(/normalised/);
  });

  test("the ideal compressed size is entropy times count", () => {
    const r = shannonEntropy([0.5, 0.5], 1000)!;
    expect(r.idealBits!).toBeCloseTo(1000, 9);
  });

  test("binary entropy matches the general form and peaks at one half", () => {
    expect(binaryEntropyBits(0.5)).toBeCloseTo(1, 15);
    expect(binaryEntropyBits(0)).toBe(0);
    expect(binaryEntropyBits(1)).toBe(0);
    for (const p of [0.1, 0.25, 0.4]) {
      expect(binaryEntropyBits(p)).toBeCloseTo(shannonEntropy([p, 1 - p])!.entropyBits, 12);
      expect(binaryEntropyBits(p)).toBeCloseTo(binaryEntropyBits(1 - p), 15);
    }
  });

  test("degenerate input is refused", () => {
    expect(shannonEntropy([])).toBeNull();
    expect(shannonEntropy([0, 0])).toBeNull();
    expect(shannonEntropy([-1, 2])).toBeNull();
  });
});

describe("channel capacity", () => {
  test("Shannon-Hartley on a hand-worked case", () => {
    // 20 dB is a linear SNR of 100; log2(101) = 6.658 bits/s/Hz.
    const r = channelCapacity(1e6, 20)!;
    expect(r.snrLinear).toBeCloseTo(100, 9);
    expect(r.spectralEfficiency).toBeCloseTo(Math.log2(101), 12);
    expect(r.capacityBps).toBeCloseTo(1e6 * Math.log2(101), 6);
  });

  test("dB uses the POWER form, 10 log10 — not 20", () => {
    // If 20 log10 were used, 20 dB would be a linear ratio of 10, not 100.
    expect(channelCapacity(1, 20)!.snrLinear).toBeCloseTo(100, 9);
    expect(channelCapacity(1, 20)!.snrLinear).not.toBeCloseTo(10, 6);
    expect(channelCapacity(1, 10)!.snrLinear).toBeCloseTo(10, 9);
    expect(channelCapacity(1, 0)!.snrLinear).toBeCloseTo(1, 12);
  });

  test("capacity is positive even below the noise floor", () => {
    const r = channelCapacity(1e6, -10)!;
    expect(r.snrLinear).toBeCloseTo(0.1, 12);
    expect(r.capacityBps).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/noise exceeds the signal/);
  });

  test("the Shannon limit of -1.59 dB is derived, not typed", () => {
    const r = channelCapacity(1e6, 0)!;
    expect(10 * Math.log10(Math.LN2)).toBeCloseTo(-1.5917, 3);
    expect(r.notes.join(" ")).toMatch(/-1\.592|−1\.592/);
  });

  test("doubling the bandwidth doubles the capacity at fixed SNR", () => {
    const a = channelCapacity(1e6, 15)!.capacityBps;
    const b = channelCapacity(2e6, 15)!.capacityBps;
    expect(b / a).toBeCloseTo(2, 12);
  });

  test("BSC capacity is 1 - h(p), zero at one half", () => {
    expect(bscCapacity(0)!.capacity).toBeCloseTo(1, 12);
    expect(bscCapacity(0.5)!.capacity).toBeCloseTo(0, 12);
    expect(bscCapacity(0.11)!.capacity).toBeCloseTo(1 - binaryEntropyBits(0.11), 12);
    expect(bscCapacity(0.5)!.notes.join(" ")).toMatch(/ZERO/);
  });

  test("a channel that mostly inverts is as good as its complement", () => {
    expect(bscCapacity(0.9)!.capacity).toBeCloseTo(bscCapacity(0.1)!.capacity, 12);
    expect(bscCapacity(0.9)!.notes.join(" ")).toMatch(/INVERTS/);
  });

  test("bad inputs refused", () => {
    expect(channelCapacity(0, 10)).toBeNull();
    expect(channelCapacity(-1, 10)).toBeNull();
    expect(bscCapacity(-0.1)).toBeNull();
    expect(bscCapacity(1.1)).toBeNull();
  });
});

describe("collision probability", () => {
  test("the classic birthday problem: 23 people, 365 days", () => {
    const r = collisionProbability(23, 365)!;
    expect(r.probability).toBeCloseTo(0.5073, 4);
    expect(r.method).toBe("exact");
  });

  test("57 people is about 99%", () => {
    expect(collisionProbability(57, 365)!.probability).toBeCloseTo(0.9901, 3);
  });

  test("the exact product matches a direct computation", () => {
    let expected = 1;
    for (let i = 1; i < 30; i++) expected *= 1 - i / 365;
    expect(collisionProbability(30, 365)!.probability).toBeCloseTo(1 - expected, 12);
  });

  test("EXPECTED PAIRS is not the probability, and can exceed 1 while p < 1", () => {
    // 40 items in 365: expected pairs = 40*39/730 = 2.14, probability ~0.891.
    const r = collisionProbability(40, 365)!;
    expect(r.expectedPairs).toBeCloseTo((40 * 39) / (2 * 365), 12);
    expect(r.expectedPairs).toBeGreaterThan(1);
    expect(r.probability).toBeLessThan(1);
    expect(r.notes.join(" ")).toMatch(/not the probability/);
  });

  test("the 50% count follows sqrt(d) with the right constant", () => {
    const r = collisionProbability(10, 365)!;
    expect(r.fiftyPercentCount).toBeCloseTo(1.1774 * Math.sqrt(365), 2);
    expect(r.fiftyPercentCount).toBeCloseTo(22.49, 1);
    // A 64-bit hash: ~5.1e9 items for even odds.
    expect(collisionProbability(2, 2 ** 64)!.fiftyPercentCount).toBeCloseTo(5.06e9, -8);
  });

  test("more items than values is CERTAIN by pigeonhole, exactly 1", () => {
    const r = collisionProbability(400, 365)!;
    expect(r.probability).toBe(1);
    expect(r.notes.join(" ")).toMatch(/pigeonhole/);
  });

  test("fewer than two items cannot collide", () => {
    expect(collisionProbability(0, 365)!.probability).toBe(0);
    expect(collisionProbability(1, 365)!.probability).toBe(0);
  });

  test("the approximation is used above the cap and stays close to exact", () => {
    const big = collisionProbability(50000, 2 ** 40)!;
    expect(big.method).toBe("approximation");
    // Compare with the exact value at the cap, where both are available.
    const atCap = collisionProbability(20000, 2 ** 40)!;
    expect(atCap.method).toBe("exact");
    const approxAtCap = -Math.expm1((-20000 * 19999) / (2 * 2 ** 40));
    expect(atCap.probability).toBeCloseTo(approxAtCap, 6);
  });

  test("probability is monotone in the number of items", () => {
    let last = -1;
    for (const n of [2, 5, 10, 23, 50, 100, 200]) {
      const p = collisionProbability(n, 365)!.probability;
      expect(p).toBeGreaterThan(last);
      last = p;
    }
  });

  test("bad inputs refused", () => {
    expect(collisionProbability(-1, 365)).toBeNull();
    expect(collisionProbability(10, 0)).toBeNull();
    expect(collisionProbability(NaN, 365)).toBeNull();
  });
});

describe("floating point", () => {
  test("machine epsilon and its decimal digits", () => {
    const r = floatPrecision(1)!;
    expect(r.epsilon).toBe(Number.EPSILON);
    expect(r.epsilon).toBeCloseTo(2.220446049250313e-16, 25);
    expect(r.decimalDigits).toBeCloseTo(15.95, 2);
  });

  test("ULP scales with magnitude — epsilon is NOT an absolute bound", () => {
    const at1 = floatPrecision(1)!;
    const atMillion = floatPrecision(1e6)!;
    expect(atMillion.ulp).toBeGreaterThan(at1.ulp * 1e5);
    // The relative spacing stays about the same.
    expect(atMillion.relativeSpacing).toBeCloseTo(at1.relativeSpacing, 15);
    expect(at1.notes.join(" ")).toMatch(/NOT an absolute error bound/);
  });

  test("ULP agrees with the actual gap to the next double", () => {
    for (const v of [1, 2, 1e6, 1e-6, 12345.678]) {
      const r = floatPrecision(v)!;
      const next = v + r.ulp;
      expect(next).toBeGreaterThan(v);
      // Half a ULP must round back to v.
      expect(v + r.ulp / 4).toBe(v);
    }
  });

  test("catastrophic cancellation is quantified in digits lost", () => {
    // 1.0000001 - 1 loses about 7 digits.
    const r = floatPrecision(1, 1.0000001)!;
    expect(r.cancellationFactor!).toBeCloseTo(1 / 1.0000001e-7, -2);
    expect(r.digitsLost!).toBeCloseTo(7, 0);
    expect(r.notes.join(" ")).toMatch(/CATASTROPHIC CANCELLATION/);
    expect(r.notes.join(" ")).toMatch(/subtraction itself is exact/);
  });

  test("exactly equal operands lose everything", () => {
    const r = floatPrecision(5, 5)!;
    expect(r.cancellationFactor).toBe(Infinity);
    expect(r.digitsLost).toBe(Infinity);
  });

  test("no cancellation is reported when none was asked for", () => {
    expect(floatPrecision(42)!.cancellationFactor).toBeNull();
  });

  test("non-finite input refused", () => {
    expect(floatPrecision(Infinity)).toBeNull();
    expect(floatPrecision(NaN)).toBeNull();
    expect(floatPrecision(1, NaN)).toBeNull();
  });
});

describe("runtime scaling", () => {
  test("perfect quadratic data recovers exponent 2", () => {
    const r = runtimeScaling(100, 1, 200, 4)!;
    expect(r.exponent).toBeCloseTo(2, 12);
    expect(r.nearestClass).toMatch(/quadratic/);
  });

  test("linear and cubic are recovered too", () => {
    expect(runtimeScaling(100, 1, 1000, 10)!.exponent).toBeCloseTo(1, 12);
    expect(runtimeScaling(10, 1, 20, 8)!.exponent).toBeCloseTo(3, 12);
  });

  test("prediction is consistent with the fitted exponent", () => {
    const r = runtimeScaling(100, 1, 200, 4, 400)!;
    // Quadratic: 400 is 2x of 200, so 4x the time.
    expect(r.predicted!).toBeCloseTo(16, 9);
    expect(r.growthFactor!).toBeCloseTo(4, 9);
  });

  test("the power-law limitation is always stated", () => {
    const r = runtimeScaling(100, 1, 200, 4)!;
    expect(r.notes.join(" ")).toMatch(/TWO POINTS FIT A POWER LAW AND NOTHING ELSE/);
    expect(r.notes.join(" ")).toMatch(/cannot see an exponential/);
  });

  test("a faster larger run is called noise, not a complexity class", () => {
    const r = runtimeScaling(100, 2, 200, 1)!;
    expect(r.exponent).toBeLessThan(0);
    expect(r.notes.join(" ")).toMatch(/NEGATIVE/);
  });

  test("extrapolating far beyond the data is flagged", () => {
    const r = runtimeScaling(100, 1, 200, 4, 1e6)!;
    expect(r.notes.join(" ")).toMatch(/extrapolation rather than interpolation/);
  });

  test("equal sizes give no leverage and are refused", () => {
    expect(runtimeScaling(100, 1, 100, 2)).toBeNull();
    expect(runtimeScaling(0, 1, 200, 4)).toBeNull();
    expect(runtimeScaling(100, 0, 200, 4)).toBeNull();
  });
});
