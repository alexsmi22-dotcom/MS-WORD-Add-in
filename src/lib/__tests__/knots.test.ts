// Knot polynomials and π₁ presentations (knots.ts) — T3/T4.
//
// The oracles are LITERATURE VALUES, and two of them are strong enough to be
// worth naming, because they caught both bugs in the first implementation:
//
//   figure-eight  V = t⁻² − t⁻¹ + 1 − t + t². The figure-eight is amphichiral,
//                 so its Jones polynomial must be PALINDROMIC. It came out
//                 missing terms, which is how the A/B smoothing bug — the two
//                 swap for a NEGATIVE crossing — announced itself. An
//                 all-positive braid hides that error completely.
//   trefoil       must have INTEGER powers of t. Half-integer powers appeared
//                 for a one-component closure, which is impossible, and that is
//                 how the inverted writhe factor showed up.
//
// The two trefoils are mirror images and must have DIFFERENT polynomials, with
// t ↔ t⁻¹ — the standard demonstration that Jones sees chirality where homology
// cannot. That relationship is asserted directly.

import {
  parseBraid, jonesPolynomial, wirtingerPresentation, countClosureComponents,
  KNOT_BRAIDS, lAdd, lMul, lMono, lOne, lZero, lFormat, Laurent,
} from "../knots";

const J = (name: string) => {
  const b = KNOT_BRAIDS[name];
  return jonesPolynomial({ word: b.word, strands: b.strands });
};

describe("Laurent polynomial arithmetic is exact", () => {
  it("adds, cancels and multiplies", () => {
    expect(lFormat(lAdd(lMono(1), lMono(1, -1)), "t")).toBe("0");
    expect(lFormat(lMul(lMono(2, 3), lMono(-1, 2)), "t")).toBe("6t");
    expect(lFormat(lOne(), "t")).toBe("1");
    expect(lFormat(lZero(), "t")).toBe("0");
  });
  it("prints fractional powers as fractions, never decimals", () => {
    expect(lFormat(lMono(-5, -1), "t", 2)).toBe("-t^(-5/2)");
    expect(lFormat(lMono(4), "t", 4)).toBe("t");
  });
});

describe("the Jones polynomial matches published values", () => {
  it("unknot: V = 1", () => {
    expect(J("unknot").jonesDisplay).toBe("1");
  });

  it("trefoil: V = −t⁻⁴ + t⁻³ + t⁻¹, with INTEGER powers as a knot must have", () => {
    const r = J("trefoil");
    expect(r.jonesDisplay).toBe("-t^-4 + t^-3 + t^-1");
    expect(r.components).toBe(1);
    // A one-component closure cannot have half-integer powers of t.
    // Math.abs, because -4 % 4 is -0 in JavaScript and Object.is(-0, 0) is false.
    for (const e of r.jones.keys()) expect(Math.abs(e % 4)).toBe(0);
  });

  it("the mirror trefoil has a DIFFERENT polynomial — Jones sees chirality", () => {
    const a = J("trefoil"), b = J("trefoil-mirror");
    expect(a.jonesDisplay).not.toBe(b.jonesDisplay);
    expect(b.jonesDisplay).toBe("t + t^3 - t^4");
    // Mirror images are related by t ↔ t⁻¹: exponents negate.
    const negated = new Set([...a.jones.entries()].map(([e, c]) => `${-e}:${c}`));
    for (const [e, c] of b.jones) expect(negated.has(`${e}:${c}`)).toBe(true);
  });

  it("figure-eight: V = t⁻² − t⁻¹ + 1 − t + t², and PALINDROMIC as an amphichiral knot", () => {
    const r = J("figure-8");
    expect(r.jonesDisplay).toBe("t^-2 - t^-1 + 1 - t + t^2");
    expect(r.components).toBe(1);
    // Amphichiral: the polynomial is invariant under t → t⁻¹.
    for (const [e, c] of r.jones) expect(r.jones.get(-e)).toBe(c);
  });

  it("cinquefoil 5₁: V = t² + t⁴ − t⁵ + t⁶ − t⁷", () => {
    expect(J("cinquefoil").jonesDisplay).toBe("t^2 + t^4 - t^5 + t^6 - t^7");
  });

  it("Hopf link: two components, and HALF-integer powers as a 2-component link must have", () => {
    const r = J("hopf-link");
    expect(r.components).toBe(2);
    expect(r.jonesDisplay).toBe("-t^(1/2) - t^(5/2)");
    // A link with an even number of components has half-integer exponents.
    expect([...r.jones.keys()].some((e) => e % 4 !== 0)).toBe(true);
  });

  it("the Solomon link is a 2-component link too", () => {
    expect(J("solomon-link").components).toBe(2);
  });

  it("every built-in braid computes and reports its component count", () => {
    for (const name of Object.keys(KNOT_BRAIDS)) {
      const r = J(name);
      expect(`${name}: ${r.components >= 1}`).toBe(`${name}: true`);
      expect(r.jones.size).toBeGreaterThan(0);
    }
  });
});

describe("braid parsing", () => {
  it("accepts the spellings people type", () => {
    expect(parseBraid("1 1 1")!.word).toEqual([1, 1, 1]);
    expect(parseBraid("s1 s1 s1")!.word).toEqual([1, 1, 1]);
    expect(parseBraid("1,-2,1,-2")!.word).toEqual([1, -2, 1, -2]);
    expect(parseBraid("σ1 σ2^-1")!.word).toEqual([1, -2]);
  });
  it("infers the strand count", () => {
    expect(parseBraid("1 1 1")!.strands).toBe(2);
    expect(parseBraid("1 -2 1 -2")!.strands).toBe(3);
  });
  it("refuses what is not a braid", () => {
    expect(parseBraid("")).toBeNull();
    expect(parseBraid("hello")).toBeNull();
    expect(parseBraid("0")).toBeNull(); // σ₀ does not exist
  });
});

describe("component counting", () => {
  it("counts the cycles of the underlying permutation", () => {
    expect(countClosureComponents({ word: [1, 1, 1], strands: 2 })).toBe(1); // trefoil
    expect(countClosureComponents({ word: [1, 1], strands: 2 })).toBe(2);    // Hopf link
    expect(countClosureComponents({ word: [], strands: 3 })).toBe(3);        // 3 unknots
  });
});

describe("the cap refuses rather than truncating", () => {
  it("too many crossings is refused, because a partial state sum is WRONG not incomplete", () => {
    const word = Array.from({ length: 25 }, () => 1);
    expect(() => jonesPolynomial({ word, strands: 2 })).toThrow(/WRONG polynomial rather than an incomplete one/);
  });
  it("a braid at the limit still computes", () => {
    const word = Array.from({ length: 14 }, (_, i) => (i % 2 ? 1 : -1));
    const t0 = Date.now();
    expect(() => jonesPolynomial({ word, strands: 2 })).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(10000);
  });
});

describe("π₁ is PRESENTED and ABELIANISED, never identified", () => {
  it("gives a Wirtinger presentation with one relation per crossing", () => {
    const w = wirtingerPresentation({ word: [1, 1, 1], strands: 2 });
    expect(w.generators.length).toBeGreaterThan(2);
    expect(w.relations.length).toBeGreaterThanOrEqual(3);
    expect(w.relations.some((r) => /\^-1/.test(r))).toBe(true); // conjugation
  });
  it("abelianises to Z for a knot and Z^k for a k-component link", () => {
    expect(wirtingerPresentation({ word: [1, 1, 1], strands: 2 }).abelianisation).toBe("Z");
    expect(wirtingerPresentation({ word: [1, 1], strands: 2 }).abelianisation).toBe("Z^2");
  });
  it("states that the word problem makes identification undecidable", () => {
    const w = wirtingerPresentation({ word: [1, 1, 1], strands: 2 });
    const all = w.caveats.join(" ");
    expect(all).toMatch(/UNDECIDABLE/);
    expect(all).toMatch(/Novikov–Boone/);
    expect(all).toMatch(/never claims to recognise/);
  });
  it("says why H₁ alone distinguishes no knots", () => {
    expect(wirtingerPresentation({ word: [1, 1, 1], strands: 2 }).caveats.join(" "))
      .toMatch(/always Z, which is exactly why H₁ alone distinguishes no knots/);
  });
});

describe("honesty about what the polynomial proves", () => {
  it("every result states that Jones is NOT a complete invariant", () => {
    const r = J("trefoil");
    const all = r.caveats.join(" ");
    expect(all).toMatch(/NOT a complete invariant/);
    expect(all).toMatch(/Kinoshita–Terasaka/);
    expect(all).toMatch(/evidence, never proof/);
  });
  it("mentions that different braid words can give the same knot", () => {
    expect(J("figure-8").caveats.join(" ")).toMatch(/Markov moves/);
  });
});
