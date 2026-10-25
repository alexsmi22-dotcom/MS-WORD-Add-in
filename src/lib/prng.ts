/**
 * PCG32 (O'Neill 2014, "PCG: A Family of Simple Fast Space-Efficient Statistically Good Algorithms for Random Number
 * Generation", HMC-CS-2014-0905): the 64-bit LCG state, multiplier 6364136223846793005, odd increment (stream), and
 * the XSH-RR output permutation, exactly as pcg_basic.c's pcg32_random_r. Seeding is pcg32_srandom_r(initstate,
 * initseq). Bounded integers are pcg32_boundedrand_r: draw r and reject it while r < (2³² − bound) mod bound, then
 * return r mod bound. That rejection removes the modulo bias exactly (the accepted range is a whole multiple of the
 * bound), so every index 0…bound − 1 is equally likely.
 *
 * Pinned in jest against the reference implementation's PUBLISHED output: pcg-c, test-high/expected/check-pcg32.out
 * (github.com/imneme/pcg-c; seed 42, stream 54: the 32-bit values, coin tosses, dice rolls and card shuffles of all
 * five rounds, the last three of which exercise the bounded method). Ported under the Apache License 2.0
 * (Copyright 2014 Melissa O'Neill); see THIRD_PARTY_LICENSES.md.
 *
 * JavaScript has no 64-bit integer multiply short of BigInt (far too slow for n·B draws), so the state is two uint32
 * halves and the product is formed from 16-bit pieces, each exact in a double.
 */

/** 6364136223846793005 = 0x5851F42D_4C957F2D. */
const MUL_HI = 0x5851f42d;
const MUL_LO = 0x4c957f2d;
const TWO32 = 4294967296;
/**
 * Bound once: under jest's node environment every `Math.x` property lookup costs ~100 ns (measured 20× slower than
 * a local alias), which turned a 0.5 s bootstrap into a 6 s refusal in the test runner. The browser is unaffected.
 */
const imul = Math.imul;

/** The stream (initseq) every JurisLab bootstrap uses: the reference demo's 54, so seed 42 reproduces its output. */
export const PCG_STREAM = 54;
/** The largest seed accepted: the state initializer is 64 bits, but a seed must be an exact integer in a double. */
export const PCG_MAX_SEED = Number.MAX_SAFE_INTEGER;

export class Pcg32 {
  private hi = 0;
  private lo = 0;
  private incHi = 0;
  private incLo = 0;

  /** pcg32_srandom_r(initstate = seed, initseq = stream). Both must be integers 0 … 2⁵³ − 1. */
  constructor(seed: number, stream: number = PCG_STREAM) {
    if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError("seed must be a whole number 0 … 2⁵³ − 1");
    if (!Number.isSafeInteger(stream) || stream < 0) throw new RangeError("stream must be a whole number 0 … 2⁵³ − 1");
    // inc = (initseq << 1) | 1, as a 64-bit value.
    const sHi = Math.floor(stream / TWO32);
    const sLo = stream - sHi * TWO32;
    this.incHi = ((sHi << 1) | (sLo >>> 31)) >>> 0;
    this.incLo = ((sLo << 1) | 1) >>> 0;
    this.hi = 0;
    this.lo = 0;
    this.nextU32();
    // state += initstate (64-bit add).
    const iHi = Math.floor(seed / TWO32);
    const iLo = seed - iHi * TWO32;
    const s = this.lo + iLo;
    this.lo = s >>> 0;
    this.hi = (this.hi + iHi + (s >= TWO32 ? 1 : 0)) >>> 0;
    this.nextU32();
  }

  /** pcg32_random_r: the next uniformly distributed 32-bit unsigned integer. */
  nextU32(): number {
    const oldHi = this.hi;
    const oldLo = this.lo;
    // state = old · MUL + inc (mod 2⁶⁴). lo·MUL_LO in full, from 16-bit pieces.
    const a0 = oldLo & 0xffff;
    const a1 = oldLo >>> 16;
    const b0 = MUL_LO & 0xffff;
    const b1 = MUL_LO >>> 16;
    const p00 = a0 * b0;
    const p01 = a0 * b1;
    const p10 = a1 * b0;
    const p11 = a1 * b1;
    const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
    const prodLo = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0;
    const prodHi = p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16);
    const sumLo = prodLo + this.incLo;
    this.lo = sumLo >>> 0;
    this.hi = (imul(oldHi, MUL_LO) + imul(oldLo, MUL_HI) + prodHi + this.incHi + (sumLo >= TWO32 ? 1 : 0)) >>> 0;
    // XSH-RR on the OLD state: xorshifted = ((old >> 18) ^ old) >> 27, rot = old >> 59.
    const xHi = oldHi ^ (oldHi >>> 18);
    const xLo = oldLo ^ (((oldLo >>> 18) | (oldHi << 14)) >>> 0);
    const xs = ((xLo >>> 27) | (xHi << 5)) >>> 0;
    const rot = oldHi >>> 27;
    return ((xs >>> rot) | (xs << (-rot & 31))) >>> 0;
  }

  /**
   * Fills `out` with successive bounded(bound) draws: the same stream and the same values as calling bounded() once
   * per element, validated once (the bootstrap's hot path: n·B draws).
   */
  fillBounded(out: Int32Array, bound: number): void {
    if (!Number.isInteger(bound) || bound < 1 || bound > 2147483647) throw new RangeError("bound must be a whole number 1 … 2³¹ − 1");
    const threshold = (TWO32 - bound) % bound;
    const len = out.length;
    for (let i = 0; i < len; i++) {
      let r = this.nextU32();
      // Rejection, as bounded(): each try is accepted with probability above 1/2.
      let guard = 0;
      while (r < threshold) {
        if (++guard > 200) throw new Error("PCG32 bounded draw rejected 200 times in a row");
        r = this.nextU32();
      }
      out[i] = r % bound;
    }
  }

  /** pcg32_boundedrand_r: an unbiased integer 0 … bound − 1 (bound 1 … 2³²). */
  bounded(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1 || bound > TWO32) throw new RangeError("bound must be a whole number 1 … 2³²");
    const threshold = (TWO32 - bound) % bound;
    // Each draw is accepted with probability ≥ 1/2, so 200 rejections in a row has probability below 2⁻²⁰⁰.
    for (let k = 0; k < 200; k++) {
      const r = this.nextU32();
      if (r >= threshold) return r % bound;
    }
    throw new Error("PCG32 bounded draw rejected 200 times in a row");
  }
}
