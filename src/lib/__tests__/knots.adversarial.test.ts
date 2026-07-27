// Adversarial bug test — knot polynomials (knots.ts).
//
// The pass ran before shipping and the two bugs it found were both invisible to
// a naive test:
//
//   1. The A- and B-smoothings SWAP for a negative crossing. Treating every
//      crossing alike is correct only when all crossings share a sign, so an
//      all-positive trefoil looked nearly right while the mixed-sign
//      figure-eight came back missing terms.
//   2. The writhe factor was raised to +writhe instead of -writhe, which gave a
//      one-component knot HALF-INTEGER powers of t. That is impossible, and is
//      how the error announced itself.
//
// The strongest check here is MARKOV STABILISATION: adding a strand with a
// single crossing produces a different braid whose closure is the SAME knot, so
// the polynomial must be unchanged. It exercises the bracket, the writhe factor
// and the substitution together, against a fact none of them knows.

import { parseBraid, jonesPolynomial, wirtingerPresentation, KNOT_BRAIDS } from "../knots";

describe("Markov stabilisation leaves the polynomial invariant", () => {
  const CASES: number[][] = [[1, 1, 1], [1, -2, 1, -2], [1, 1, 1, 1, 1], [-1, -1, -1]];
  for (const word of CASES) {
    it(`[${word}] survives adding a strand`, () => {
      const strands = Math.max(2, ...word.map((g) => Math.abs(g) + 1));
      const base = jonesPolynomial({ word, strands });
      const stabilised = jonesPolynomial({ word: [...word, strands], strands: strands + 1 });
      expect(stabilised.jonesDisplay).toBe(base.jonesDisplay);
    });
  }
});

describe("the parity law relates components to exponents", () => {
  it("a knot has integer t-powers; an even-component link has half-integer ones", () => {
    for (const [name, b] of Object.entries(KNOT_BRAIDS)) {
      const r = jonesPolynomial({ word: b.word, strands: b.strands });
      const halfInt = [...r.jones.keys()].some((e) => e % 4 !== 0);
      const expectHalf = r.components % 2 === 0;
      expect(`${name}: half=${halfInt}`).toBe(`${name}: half=${expectHalf}`);
    }
  });
});

describe("the caps are measured, and keep the pane usable", () => {
  it("past the crossing cap is refused, not truncated", () => {
    const word = Array.from({ length: 25 }, () => 1);
    expect(() => jonesPolynomial({ word, strands: 2 })).toThrow(/WRONG polynomial/);
  });
  it("a braid at the cap still returns quickly enough to type against", () => {
    const word = Array.from({ length: 16 }, (_, i) => (i % 3 === 0 ? -1 : 1));
    const t0 = Date.now();
    jonesPolynomial({ word, strands: 2 });
    // 20 crossings measured ~13 SECONDS, which froze the pane per keystroke.
    expect(Date.now() - t0).toBeLessThan(8000);
  });
  it("an absurd strand count is refused rather than built", () => {
    expect(parseBraid("999")).toBeNull();
  });
});

describe("degenerate braids compute without nonsense", () => {
  const CASES: [string, number[], number][] = [
    ["empty word, 1 strand", [], 1],
    ["empty word, 5 strands", [], 5],
    ["single crossing", [1], 2],
    ["cancelling pair", [1, -1], 2],
    ["many strands, one crossing", [1], 8],
    ["alternating signs", [1, -1, 1, -1, 1, -1], 2],
    ["all negative", [-1, -1, -1, -1], 2],
  ];
  for (const [name, word, strands] of CASES) {
    it(`${name} produces a well-formed polynomial`, () => {
      const r = jonesPolynomial({ word, strands });
      expect(r.jones.size).toBeGreaterThan(0);
      expect(r.components).toBeGreaterThanOrEqual(1);
      for (const [, c] of r.jones) expect(Number.isInteger(c)).toBe(true);
      expect(r.jonesDisplay).not.toMatch(/NaN|Infinity|undefined/);
    });
  }
  it("the unknot in any number of strands still has a sensible polynomial", () => {
    expect(jonesPolynomial({ word: [], strands: 1 }).jonesDisplay).toBe("1");
    expect(jonesPolynomial({ word: [1], strands: 2 }).jonesDisplay).toBe("1");
  });
});

describe("the parser refuses misreadable input rather than guessing", () => {
  it("a decimal is refused, not split into two generators", () => {
    // "1.5" was being read as the generators 1 and 5.
    expect(parseBraid("1.5")).toBeNull();
    expect(parseBraid("2.75")).toBeNull();
  });
  it("empty, zero and non-numeric input return null", () => {
    for (const s of ["", "  ", "0", "abc", "1 0 1", "-0", "s", "σ"]) {
      expect(`${JSON.stringify(s)}: ${parseBraid(s) === null ? "null" : "parsed"}`)
        .toBe(`${JSON.stringify(s)}: null`);
    }
  });
  it("the spellings people actually type still work", () => {
    expect(parseBraid("1 1 1")!.word).toEqual([1, 1, 1]);
    expect(parseBraid("1,-2,1,-2")!.word).toEqual([1, -2, 1, -2]);
  });
});

describe("Wirtinger stays cheap and honest at scale", () => {
  it("scales linearly and never claims to identify the group", () => {
    for (const n of [3, 10, 16]) {
      const t0 = Date.now();
      const w = wirtingerPresentation({ word: Array.from({ length: n }, () => 1), strands: 2 });
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(w.relations.length).toBeGreaterThanOrEqual(n);
      expect(w.caveats.join(" ")).toMatch(/never claims to recognise/);
    }
  });
});
