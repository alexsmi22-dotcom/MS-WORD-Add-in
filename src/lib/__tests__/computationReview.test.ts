// Regressions for the defects an independent review found in computation.ts.
import { floatPrecision, parallelSpeedup, collisionProbability, runtimeScaling } from "../computation";

/** True spacing to the next double, from the bit pattern. */
function trueUlp(x: number): number {
  const b = new ArrayBuffer(8);
  new Float64Array(b)[0] = Math.abs(x);
  const u = new BigUint64Array(b);
  u[0] += 1n;
  return new Float64Array(b)[0] - Math.abs(x);
}

describe("ULP is exact, not derived from a logarithm", () => {
  test("the top of a binade is NOT reported at twice the true spacing", () => {
    // Math.log2 returns the exponent exactly just below a power of two, so floor
    // gave e instead of e-1 and the spacing came out 2x too large.
    for (const v of [1023.9999999999999, 65535.99999999999, 1048575.9999999999, 2 ** 53 - 1]) {
      expect(floatPrecision(v)!.ulp).toBeCloseTo(trueUlp(v), 30);
    }
  });

  test("half a ULP rounds away across a wide sweep, including binade tops", () => {
    const vals = [1, 2, 1e6, 1e-6, 12345.678, 1023.9999999999999, 2 ** 40 - 1, 0.5, 3, 7.5];
    for (const v of vals) {
      const u = floatPrecision(v)!.ulp;
      expect(v + u).toBeGreaterThan(v);
      expect(v + u / 4).toBe(v);
    }
  });

  test("subnormals do NOT report a spacing of zero", () => {
    // Math.pow underflowed below 2^-1022, so 1e-310 claimed infinite precision
    // exactly where doubles have the least.
    for (const v of [1e-310, Number.MIN_VALUE, 2 ** -1023]) {
      const r = floatPrecision(v)!;
      expect(r.ulp).toBeGreaterThan(0);
      expect(r.ulp).toBe(Number.MIN_VALUE);
      expect(r.relativeSpacing).toBeGreaterThan(0);
    }
  });

  test("negative values use the magnitude", () => {
    expect(floatPrecision(-1e6)!.ulp).toBe(floatPrecision(1e6)!.ulp);
  });
});

describe("the efficiency metric replaced the quantised knee", () => {
  test("it is a closed form, not a power of two", () => {
    // E = 1/(N(1-p)+p) = 1/2  =>  N = (2-p)/(1-p).
    for (const p of [0, 0.5, 0.9, 0.95, 0.999999]) {
      expect(parallelSpeedup(p, 8)!.halfEfficiencyN).toBeCloseTo((2 - p) / (1 - p), 9);
    }
  });

  test("a FULLY SERIAL program does not report 'never'", () => {
    // The old loop was guarded by p > 0, so p = 0 returned Infinity - "no
    // diminishing returns" for the one program that is nothing but.
    const r = parallelSpeedup(0, 64)!;
    expect(r.halfEfficiencyN).toBeCloseTo(2, 12);
    expect(r.halfEfficiencyN).not.toBe(Infinity);
  });

  test("only a perfectly parallel program never wastes half the machine", () => {
    expect(parallelSpeedup(1, 64)!.halfEfficiencyN).toBe(Infinity);
    // And an extreme but finite p is finite, where the old cap returned Infinity.
    expect(parallelSpeedup(0.999999, 8)!.halfEfficiencyN).toBeLessThan(Infinity);
  });

  test("the reported N really is where efficiency hits one half", () => {
    for (const p of [0.5, 0.9, 0.99]) {
      const n = parallelSpeedup(p, 8)!.halfEfficiencyN;
      expect(parallelSpeedup(p, n)!.efficiency).toBeCloseTo(0.5, 9);
    }
  });

  test("a superlinear measurement is flagged, not silently negative", () => {
    const r = parallelSpeedup(0.9, 8, 9)!;
    expect(r.karpFlatt!).toBeLessThan(0);
    expect(r.notes.join(" ")).toMatch(/NEGATIVE, which is not physically meaningful/);
  });
});

describe("collision and scaling edges", () => {
  test("a fractional item count is refused rather than answered for two different n", () => {
    expect(collisionProbability(2.5, 3)).toBeNull();
    expect(collisionProbability(23, 365)).not.toBeNull();
  });

  test("logarithmic data is not filed under O(1)", () => {
    // Genuine log n from 1e6 to 1e9 fits k = 0.059, which the old table (log n
    // pinned at k = 0.15) reported as "O(1), constant".
    const n1 = 1e6;
    const n2 = 1e9;
    const r = runtimeScaling(n1, Math.log2(n1), n2, Math.log2(n2))!;
    expect(r.exponent).toBeCloseTo(0.0587, 3);
    expect(r.nearestClass).not.toMatch(/constant/);
    expect(r.notes.join(" ")).toMatch(/SUB-LINEAR/);
  });

  test("an exponent far from any named class says so instead of naming one", () => {
    const r = runtimeScaling(100, 1, 1000, Math.pow(10, 1.5))!;
    expect(r.exponent).toBeCloseTo(1.5, 9);
    expect(r.nearestClass).toMatch(/between named classes/);
  });

  test("a genuine quadratic is still named", () => {
    expect(runtimeScaling(100, 1, 200, 4)!.nearestClass).toMatch(/quadratic/);
  });
});
