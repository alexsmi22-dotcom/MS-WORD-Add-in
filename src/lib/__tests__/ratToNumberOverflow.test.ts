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

// ---------------------------------------------------------------------------
// The BAND — found by an independent review of the fix above
// ---------------------------------------------------------------------------
//
// The first version of the slow path shifted both sides right until the SMALLER
// had ~64 bits. That preserves the ratio but leaves the LARGER side with
// (gap + 64) bits, so it still overflowed once the gap between the two exceeded
// about 960 — while a double does not run out until 1024. The result was a band,
// gaps 961-1023, where a perfectly representable number came back as Infinity,
// and a mirrored band returning 0 for everything from ~1e-289 down through the
// whole subnormal range.
//
// Being wrong in a BAND is worse than being wrong everywhere: the original tests
// sampled gap 0 and gap ~1300 and passed, straddling it. These tests walk the
// boundary deliberately.
//
// The constructions use 3^a over 5^b because they are COPRIME — `ratDiv` reduces
// by the gcd, so anything sharing a factor collapses into the fast path and never
// exercises the code under test at all. The first attempt at reproducing this bug
// failed for exactly that reason.

describe("the overflow band, and correct rounding, checked EXACTLY", () => {
  // THE PREVIOUS VERSION OF THIS BLOCK WAS NOT A CHECK.
  //
  // It defined a `reference()` described as "Independent reference", with a
  // comment claiming it was validated before use — and its body was a
  // line-for-line copy of the production slow path. Every
  // `expect(ratToNumber(x)).toEqual(reference(x))` was a tautology, and it
  // certified a version that was NOT correctly rounded. That is exactly the
  // failure this repo had already written a commit message condemning: an oracle
  // of self-consistency cannot detect a consistent error.
  //
  // So this does not recompute the answer at all. It VERIFIES one, in exact
  // integer arithmetic: a double v is the correctly rounded value of N/D exactly
  // when no neighbouring double is strictly closer. That is independent of
  // however v was produced, and cannot drift into agreeing with the code.

  /** The exact rational value of a finite double. */
  function toRat(v: number): { n: bigint; d: bigint } {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, v);
    const bits = (BigInt(buf.getUint32(0)) << 32n) | BigInt(buf.getUint32(4));
    const expo = Number((bits >> 52n) & 0x7ffn);
    const man = bits & 0xfffffffffffffn;
    const sign = bits >> 63n === 1n ? -1n : 1n;
    if (expo === 0) return { n: sign * man, d: 1n << 1074n };
    const e = expo - 1075;
    const mant = sign * (man | (1n << 52n));
    return e >= 0 ? { n: mant << BigInt(e), d: 1n } : { n: mant, d: 1n << BigInt(-e) };
  }

  /** The doubles either side of v, by bit pattern. */
  function neighbours(v: number): [number, number] {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, v);
    const bits = (BigInt(buf.getUint32(0)) << 32n) | BigInt(buf.getUint32(4));
    const back = (b: bigint): number => {
      const x = new DataView(new ArrayBuffer(8));
      x.setUint32(0, Number(b >> 32n));
      x.setUint32(4, Number(b & 0xffffffffn));
      return x.getFloat64(0);
    };
    return [back(bits - 1n), back(bits + 1n)];
  }

  /** |N/D - a| <= |N/D - b|, exactly. */
  function closerOrEqual(N: bigint, D: bigint, a: number, b: number): boolean {
    const A = toRat(a);
    const B = toRat(b);
    const da = N * A.d - A.n * D;
    const db = N * B.d - B.n * D;
    const abs = (x: bigint) => (x < 0n ? -x : x);
    return abs(da) * B.d <= abs(db) * A.d;
  }

  /**
   * TOTAL: every input gets a verdict, including 0 and Infinity.
   *
   * The first version returned `null` for those and the sweeps skipped them —
   * which made it structurally blind to BOTH bugs it was written to replace.
   * v1's bug was a representable value coming back as Infinity (null, skipped);
   * v2's was MIN_VALUE coming back as 0 (null, skipped). It also filtered out a
   * non-finite neighbour, so `MAX_VALUE` was accepted where `Infinity` is right,
   * and it compared with `<=`, so at an exact tie BOTH candidates passed and
   * ties-to-even was asserted nowhere.
   */
  // The midpoint between MAX_VALUE and 2^1024: (2^54 - 1) * 2^970. At or above
  // it, Infinity is the correctly rounded answer; below it, MAX_VALUE is.
  const OVERFLOW_MIDPOINT = ((1n << 54n) - 1n) << 970n;

  function correctlyRounded(N: bigint, D: bigint, v: number): boolean {
    if (Number.isNaN(v)) return false;
    const neg = N < 0n !== D < 0n;
    const an = N < 0n ? -N : N;
    const ad = D < 0n ? -D : D;
    if (v === Infinity || v === -Infinity) {
      if (neg !== (v === -Infinity)) return false;
      return an >= ad * OVERFLOW_MIDPOINT;
    }
    if (v === 0) {
      // Rounds to zero exactly when |N/D| <= 2^-1075 — the tie goes to even = 0.
      return an * (1n << 1075n) <= ad;
    }
    const [lo, hi] = neighbours(v);
    for (const b of [lo, hi]) {
      if (Number.isFinite(b)) {
        // Strictly closer, or equidistant with v's mantissa even.
        if (!closerOrEqual(N, D, v, b)) return false;
        if (equidistant(N, D, v, b) && !mantissaIsEven(v)) return false;
      } else {
        // The neighbour is +/-Infinity: v is MAX_VALUE. It is correct only if
        // N/D is below the midpoint to 2^1024.
        if (an >= ad * OVERFLOW_MIDPOINT) return false;
      }
    }
    return true;
  }

  function equidistant(N: bigint, D: bigint, a: number, b: number): boolean {
    const A = toRat(a);
    const B = toRat(b);
    const abs = (x: bigint) => (x < 0n ? -x : x);
    return abs(N * A.d - A.n * D) * B.d === abs(N * B.d - B.n * D) * A.d;
  }

  function mantissaIsEven(v: number): boolean {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, v);
    return (BigInt(buf.getUint32(4)) & 1n) === 0n;
  }

  /** Deterministic odd BigInt of roughly `bits` bits, so a failure reproduces. */
  function odd(bits: number, seed: number): bigint {
    let s = seed >>> 0;
    let v = 0n;
    for (let i = 0; i < bits; i += 30) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      v = (v << 30n) | BigInt(s >>> 2);
    }
    return v | 1n;
  }

  test("the verifier itself is sound — it accepts truth and rejects a neighbour", () => {
    for (const v of [1, 0.5, 3.25, 1e300, 5e-324, 2.2250738585072014e-308]) {
      const r = toRat(v);
      expect({ v, ok: correctlyRounded(r.n, r.d, v) }).toEqual({ v, ok: true });
      for (const nb of neighbours(v)) {
        if (Number.isFinite(nb) && nb !== v) {
          expect({ v, nb, accepted: correctlyRounded(r.n, r.d, nb) }).toEqual({ v, nb, accepted: false });
        }
      }
    }
  });

  test.each([
    ["normal range", 1200, 1150],
    ["wide gap", 2000, 1100],
    ["subnormal results", 1000, 2050],
    ["tiny over huge", 1200, 1500],
  ])("%s: every slow-path result is the NEAREST double", (_label, nb, db) => {
    let checked = 0;
    const wrong: string[] = [];
    for (let i = 0; i < 1500; i++) {
      const N = odd(nb as number, 0x9e37 + i);
      const D = odd(db as number, 0x85eb + i * 7);
      if (Number.isFinite(Number(N)) && Number.isFinite(Number(D))) continue;
      const v = ratToNumber(ratDiv(ratInt(N), ratInt(D)));
      checked++;
      const ok = correctlyRounded(N, D, v);
      if (!ok) wrong.push(`${N}/${D} -> ${v}`);
    }
    expect(checked).toBeGreaterThan(200);
    expect(wrong.slice(0, 3)).toEqual([]);
  });

  test("a tie broken far below the 64th bit is still rounded up", () => {
    // 1 + 2^-53 + 2^-1063. The 64-bit version floored away the term that breaks
    // the tie and returned exactly 1.
    const N = ((1n << 64n) + (1n << 11n)) * (1n << 999n) + 1n;
    const D = 1n << 1063n;
    const v = ratToNumber(ratDiv(ratInt(N), ratInt(D)));
    expect(correctlyRounded(N, D, v)).toBe(true);
    expect(v).toBe(1.0000000000000002);
  });

  test("a value just above half of MIN_VALUE rounds up, not to zero", () => {
    const N = (3n ** 700n << 400n) + 1n;
    const D = 3n ** 700n << 1475n;
    expect(ratToNumber(ratDiv(ratInt(N), ratInt(D)))).toBe(5e-324);
  });

  test("coprime ratios across the whole gap range are finite and nearest", () => {
    const bitLen = (v: bigint) => v.toString(2).length;
    const D = 5n ** 120n;
    for (const gap of [900, 940, 958, 959, 960, 961, 962, 980, 1000, 1010, 1023]) {
      const a = Math.round((gap + bitLen(D)) / Math.log2(3));
      const N = 3n ** BigInt(a);
      const v = ratToNumber(ratDiv(ratInt(N), ratInt(D)));
      expect({ gap, finite: Number.isFinite(v) }).toEqual({ gap, finite: true });
      expect({ gap, ok: correctlyRounded(N, D, v) }).toEqual({ gap, ok: true });
    }
  });

  test("the mirrored band does not flush representable small values to zero", () => {
    const bitLen = (v: bigint) => v.toString(2).length;
    const N = 5n ** 120n;
    for (const gap of [900, 959, 960, 961, 1000, 1023, 1060]) {
      const b = Math.round((gap + bitLen(N)) / Math.log2(3));
      const D = 3n ** BigInt(b);
      const v = ratToNumber(ratDiv(ratInt(N), ratInt(D)));
      expect({ gap, zero: v === 0 }).toEqual({ gap, zero: false });
      expect({ gap, ok: correctlyRounded(N, D, v) }).toEqual({ gap, ok: true });
    }
  });

  test("a truly out-of-range ratio still overflows or underflows", () => {
    const bitLen = (v: bigint) => v.toString(2).length;
    const D = 5n ** 120n;
    const aBig = Math.round((1200 + bitLen(D)) / Math.log2(3));
    expect(ratToNumber(ratDiv(ratInt(3n ** BigInt(aBig)), ratInt(D)))).toBe(Infinity);
    const N = 5n ** 120n;
    const bBig = Math.round((1300 + bitLen(N)) / Math.log2(3));
    expect(ratToNumber(ratDiv(ratInt(N), ratInt(3n ** BigInt(bBig))))).toBe(0);
  });

  test("signs survive the whole range", () => {
    const bitLen = (v: bigint) => v.toString(2).length;
    const D = 5n ** 120n;
    const a = Math.round((1000 + bitLen(D)) / Math.log2(3));
    const N = 3n ** BigInt(a);
    const pos = ratToNumber(ratDiv(ratInt(N), ratInt(D)));
    expect(ratToNumber(ratDiv(ratInt(-N), ratInt(D)))).toBe(-pos);
  });

  test("the slow path stays fast enough for a per-keystroke pane", () => {
    // A HANG DETECTOR, not a performance gate. A Date.now() delta counts every
    // millisecond the thread spent descheduled, so under a full parallel run
    // this figure tracks how many other suites are running — a 4 s budget that
    // passed alone failed in the full suite with nothing having got slower. The
    // real regression this guards against (an accidental quadratic, or losing
    // the early exits) is orders of magnitude, not a factor of three.
    // gap ~848, inside the legal band. 3^3000 / 5^1500 has gap 1272 and takes
    // the e > 1100 early exit, so the previous version timed a loop that never
    // shifted a single BigInt.
    const N = 3n ** 2000n;
    const D = 5n ** 1000n;
    const t0 = Date.now();
    for (let i = 0; i < 500; i++) ratToNumber(ratDiv(ratInt(N + BigInt(i)), ratInt(D)));
    expect(Date.now() - t0).toBeLessThan(30000);
  });
});
