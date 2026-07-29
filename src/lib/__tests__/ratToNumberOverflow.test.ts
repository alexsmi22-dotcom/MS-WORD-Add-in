// ratToNumber must survive a ratio whose two sides each overflow a double.
//
// Found by a hostile-magnitude sweep, not by a feature test. `Number(n)/Number(d)`
// converts the two sides INDEPENDENTLY, so a perfectly ordinary ratio built from
// two 600-digit integers came back as Infinity/Infinity = NaN. The exact rational
// was correct throughout; only the conversion that hands the value to the user
// destroyed it — which is the worst place for it in a library whose whole claim
// is that the arithmetic is exact.
//
// It was reachable on the ordinary rigid-support beam path (a 1e308 distributed
// load), so it predates elastic supports; that is what makes it worth its own
// file rather than a line in the beam tests.

import { analyzeBeam } from "../beam";
import { Rat, ratInt, ratDiv, ratToNumber, parseRatLiteral } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
const X = (s: string): Rat => parseRatLiteral(s) as Rat;

/** Builds n/d as exact BigInts scaled so both sides are astronomically large. */
function bigRatio(value: bigint, scaleDigits: number): Rat {
  const s = 10n ** BigInt(scaleDigits);
  return ratDiv(ratInt(value * s), ratInt(s));
}

describe("a ratio of two overflowing BigInts", () => {
  test("15 stays 15 even when written as a 600-digit over a 600-digit integer", () => {
    expect(ratToNumber(bigRatio(15n, 600))).toBe(15);
  });

  test("and so do a spread of ordinary values at absurd scale", () => {
    for (const v of [1n, 2n, 7n, 100n, 999n, -3n, -1234n]) {
      for (const digits of [320, 400, 600, 900]) {
        expect(ratToNumber(bigRatio(v, digits))).toBe(Number(v));
      }
    }
  });

  test("a non-integer ratio keeps full double precision at absurd scale", () => {
    // 1/3 with both sides pushed far past the double range.
    const s = 10n ** 700n;
    const third = ratDiv(ratInt(s), ratInt(3n * s));
    expect(ratToNumber(third)).toBeCloseTo(1 / 3, 15);
  });

  test("the fast path is unchanged for ordinary rationals", () => {
    expect(ratToNumber(ratDiv(ratInt(1n), ratInt(3n)))).toBe(1 / 3);
    expect(ratToNumber(R(-7, 2))).toBe(-3.5);
    expect(ratToNumber(R(0))).toBe(0);
    expect(ratToNumber(R(20))).toBe(20);
  });

  test("a genuinely enormous ratio is still Infinity, and a tiny one still 0", () => {
    // Numerator thousands of bits longer than the denominator: out of range is
    // the CORRECT double, and the shift must not rescue it into a wrong number.
    const huge = ratDiv(ratInt(10n ** 400n), ratInt(1n));
    expect(ratToNumber(huge)).toBe(Infinity);
    const tiny = ratDiv(ratInt(1n), ratInt(10n ** 400n));
    expect(ratToNumber(tiny)).toBe(0);
    const negHuge = ratDiv(ratInt(-(10n ** 400n)), ratInt(1n));
    expect(ratToNumber(negHuge)).toBe(-Infinity);
  });

  test("signs survive the slow path", () => {
    expect(ratToNumber(bigRatio(-15n, 600))).toBe(-15);
    const s = 10n ** 600n;
    expect(ratToNumber(ratDiv(ratInt(15n * s), ratInt(-s)))).toBe(-15);
  });
});

describe("the beam results that exposed it", () => {
  test("a rigid beam under an absurd load no longer reports a non-finite reaction", () => {
    // wL/2 with w = 1e308 and L = 8 is 4e308, which genuinely overflows — but the
    // PRE-EXISTING failure was at w = 1e308, L = 8 returning NaN rather than the
    // correct Infinity. Either way it must not be NaN.
    const r = analyzeBeam({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: X("1e308") }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) for (const re of r.reactions) expect(Number.isNaN(re.force)).toBe(false);
  });

  test("a near-rigid spring with a tiny EI reports its real reaction instead of NaN", () => {
    const r = analyzeBeam({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8), k: X("1e300"), settle: X("0.01") },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("1e-300"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const re of r.reactions) {
        expect(Number.isNaN(re.force)).toBe(false);
        expect(Number.isFinite(re.force)).toBe(true);
      }
      // k = 1e300 is a near-RIGID prop, and the settlement-induced part scales
      // with EI, which is ~0 here — so this collapses to the ordinary rigid
      // propped cantilever, whose reactions are EI-free: 3wL/8 = 15 at the prop
      // and the remaining 25 at the wall. That the slow path lands exactly on
      // the textbook answer is the real assertion; NaN was what it used to give.
      expect(r.reactions[1].force).toBeCloseTo(15, 6);
      expect(r.reactions[0].force).toBeCloseTo(25, 6);
    }
  });

  test("equilibrium still holds when the numbers came through the slow path", () => {
    const r = analyzeBeam({
      length: R(8),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(8), k: X("1e300"), settle: X("0.01") },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(8), w: R(5) }],
      ei: X("1e-300"),
    });
    if (!r.ok) throw new Error(r.error);
    const sum = r.reactions.reduce((s, re) => s + re.force, 0);
    expect(Math.abs(sum - 40)).toBeLessThan(1e-6);
  });
});
