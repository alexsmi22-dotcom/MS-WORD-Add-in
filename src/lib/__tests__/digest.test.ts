// Virtual restriction digest.
//
// The arithmetic is easy; the topology is where digests go wrong. A plasmid with
// one cut gives ONE fragment, not two, and n cuts give n fragments rather than
// n+1. Get that backwards and every plasmid digest — which is most digests — is
// off by one. These tests pin topology first and the gel model second.

import { digest, gelBands, describeDigest } from "../digest";
import { findSites } from "../enzymes";
import type { EnzymeHit } from "../enzymes";

/** A minimal hit; only cutPosition/enzyme/overhang matter to the digest. */
const cut = (at: number | null, enzyme = "EcoRI"): EnzymeHit => ({
  enzyme,
  site: "GAATTC",
  position: at ?? 1,
  strand: 1,
  cutPosition: at,
  overhang: "5'",
  overhangLength: 4,
});

describe("linear molecules: n cuts give n+1 fragments", () => {
  test("one cut splits the molecule in two", () => {
    const r = digest(1000, [cut(300)]);
    expect(r.fragments.map((f) => f.length)).toEqual([300, 700]);
    expect(r.sizes).toEqual([700, 300]);
  });

  test("three cuts give four fragments", () => {
    const r = digest(1000, [cut(100), cut(400), cut(900)]);
    expect(r.fragments).toHaveLength(4);
    expect(r.fragments.map((f) => f.length)).toEqual([100, 300, 500, 100]);
  });

  test("the fragment lengths sum to the sequence length", () => {
    const r = digest(1000, [cut(137), cut(555), cut(902)]);
    expect(r.sizes.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  test("the outer ends belong to no enzyme", () => {
    const r = digest(500, [cut(200, "BamHI")]);
    expect(r.fragments[0].leftEnzyme).toBeNull();
    expect(r.fragments[0].rightEnzyme).toBe("BamHI");
    expect(r.fragments[1].leftEnzyme).toBe("BamHI");
    expect(r.fragments[1].rightEnzyme).toBeNull();
  });
});

describe("circular molecules: n cuts give n fragments", () => {
  test("ONE cut linearises the plasmid — one full-length fragment", () => {
    // The classic off-by-one. Two fragments here would be wrong.
    const r = digest(5000, [cut(1200)], true);
    expect(r.fragments).toHaveLength(1);
    expect(r.fragments[0].length).toBe(5000);
    expect(describeDigest(r)).toContain("linearises");
  });

  test("two cuts give two fragments, not three", () => {
    const r = digest(5000, [cut(1000), cut(3000)], true);
    expect(r.fragments).toHaveLength(2);
    expect(r.sizes).toEqual([3000, 2000]);
  });

  test("the fragment spanning the origin is measured through it", () => {
    const r = digest(5000, [cut(1000), cut(3000)], true);
    const wrap = r.fragments.find((f) => f.spansOrigin);
    expect(wrap).toBeDefined();
    // From 3001 round through the origin to 1000 = 2000 + 1000 = 3000.
    expect(wrap!.length).toBe(3000);
    expect(wrap!.start).toBe(3001);
    expect(wrap!.end).toBe(1000);
  });

  test("lengths still sum to the plasmid size", () => {
    const r = digest(7231, [cut(15), cut(2000), cut(6999)], true);
    expect(r.sizes.reduce((a, b) => a + b, 0)).toBe(7231);
    expect(r.fragments).toHaveLength(3);
  });
});

describe("what is not a cut", () => {
  test("a null cutPosition is ignored, not treated as position 0", () => {
    // findSites returns null when a Type IIS cut falls off a linear end.
    const r = digest(1000, [cut(null), cut(400)]);
    expect(r.fragments).toHaveLength(2);
    expect(r.sizes).toEqual([600, 400]);
  });

  test("two enzymes cutting at the same base make one boundary", () => {
    const r = digest(1000, [cut(500, "EcoRI"), cut(500, "MfeI")]);
    expect(r.fragments).toHaveLength(2);
  });

  test("an uncut molecule is returned intact and says so", () => {
    const r = digest(3000, [], true);
    expect(r.uncut).toBe(true);
    expect(r.sizes).toEqual([3000]);
    expect(describeDigest(r)).toContain("not cut");
  });

  test("a cut at the last base does not produce a zero-length fragment", () => {
    const r = digest(1000, [cut(1000)]);
    expect(r.fragments.every((f) => f.length > 0)).toBe(true);
    expect(r.sizes).toEqual([1000]);
  });
});

describe("the gel model", () => {
  test("well-separated fragments are separate bands", () => {
    expect(gelBands([3000, 1500, 500]).map((b) => b.count)).toEqual([1, 1, 1]);
  });

  test("fragments within the resolution limit co-migrate", () => {
    // 4000 and 3960 are 1% apart — one band on any real gel.
    const bands = gelBands([4000, 3960, 1000]);
    expect(bands).toHaveLength(2);
    expect(bands[0].count).toBe(2);
    expect(bands[0].fragments).toEqual([4000, 3960]);
  });

  test("the report says which fragments would not be told apart", () => {
    // LINEAR, so the cuts give 4000 / 3960 / 2040. (An earlier version of this
    // test used a circle, which gives 6040 / 3960 — my own off-by-topology,
    // and exactly the mistake the module exists to prevent.)
    const r = digest(10000, [cut(4000), cut(7960)], false);
    expect(r.sizes).toEqual([4000, 3960, 2040]);
    const text = describeDigest(r);
    expect(text).toContain("co-migrate");
    expect(text).toContain("2 visible bands");
  });

  test("resolution is configurable and actually changes the grouping", () => {
    expect(gelBands([4000, 3800], 1)).toHaveLength(2);
    expect(gelBands([4000, 3800], 10)).toHaveLength(1);
  });

  test("an empty gel is not a crash", () => {
    expect(gelBands([])).toEqual([]);
  });
});

describe("against real findSites output", () => {
  test("EcoRI on a sequence with two sites gives three linear fragments", () => {
    // GAATTC at two places, 30 bp apart.
    const seq = "A".repeat(20) + "GAATTC" + "T".repeat(30) + "GAATTC" + "C".repeat(20);
    const hits = findSites(seq, { only: ["EcoRI"] });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const r = digest(seq.length, hits);
    expect(r.fragments).toHaveLength(3);
    expect(r.sizes.reduce((a, b) => a + b, 0)).toBe(seq.length);
  });

  test("the same sequence as a circle gives one fewer fragment", () => {
    const seq = "A".repeat(20) + "GAATTC" + "T".repeat(30) + "GAATTC" + "C".repeat(20);
    const hits = findSites(seq, { only: ["EcoRI"] });
    const lin = digest(seq.length, hits, false);
    const circ = digest(seq.length, hits, true);
    expect(circ.fragments.length).toBe(lin.fragments.length - 1);
    expect(circ.sizes.reduce((a, b) => a + b, 0)).toBe(seq.length);
  });
});
