// Release D — GOLDEN GATE WITH A DESTINATION VECTOR.
//
// THE DEFECT. A standard Golden Gate destination vector is a plasmid carrying
// two INVERTED sites of the chosen Type IIS enzyme around a dropout (lacZα,
// ccdB, a stuffer), arranged so that both cuts fall outside the pair and both
// recognition sites leave WITH the dropout. Pasted into the backbone field it
// was refused by the per-part internal-site scan, with advice to "domesticate
// the site" — advice to break the vector, on the commonest Golden Gate workflow
// there is.
//
// PART 1 of this file PINS today's behaviour on everything that already worked:
// a parts-only assembly, a plain backbone with no sites, a plain backbone whose
// only site spans the position the user pasted first, and the existing refusals.
// Those rows must stay byte-identical (sha256 of the whole result text), and
// they did: only the destination-vector rows changed.
//
// PART 2 is the ORACLE. Bio.Restriction (Biopython) digests the same plasmid and
// the fragments, cut positions and overhangs are compared with this engine's.
// Oracle script (run 2026-10-22, scratchpad/gg_oracle.py, python 3.14 +
// biopython in statvenv):
//
//   from Bio.Restriction import BsaI, BsmBI
//   BsaI.search(Seq(VECTOR), linear=False)   -> [401, 567]   # base AFTER each cut
//   # fragments, derived from those cut positions (catalyse() mis-assembles a
//   # circular digest whose cut order wraps the origin: at rotations 403-405 of
//   # this vector it returns one doubled fragment and one empty one, so the
//   # SEARCH positions are the sound oracle)
//   vector body 2690 bp, 5' overhang GCTT   (the body's own first 4 bases)
//   dropout      166 bp, 5' overhang AATG   (the 4 nt the insert must supply)
//   product = BODY + AATG + P1 + P2 = 2856 bp, and BsaI.search(product) == []
//
// and the same answer at eight rotations of the plasmid, including two that put
// a BsaI site across the origin.
//
// THE VECTOR is built here exactly as the oracle builds it, from the repo's
// pUC19 fixture (NCBI L09137.2): pUC19 carries ONE native BsaI site (reverse
// strand at 1766), so it is domesticated by a single base first — which is what
// anyone building a real BsaI destination vector on pUC19 has to do — and a
// cassette of [AATG + spacer + inverted BsaI site][stuffer][BsaI site + spacer +
// GCTT] is inserted in the lacZα region. AATG and GCTT are MoClo-style fusion
// sites.

import { createHash } from "crypto";
import { destinationVector, goldenGate, type Part } from "../cloning";
import { CLONING_CALCS } from "../cloningCalcs";
import { goldenGateSvg } from "../cloningCharts";
import { ENZYMES, findSites } from "../enzymes";
import { PUC19 } from "./fixtures/puc19";

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

const BSAI = ENZYMES.find((e) => e.name === "BsaI")!;
const BSMBI = ENZYMES.find((e) => e.name === "BsmBI")!;

/** The pane calculator, driven through its own fields. */
function run(id: string, over: Record<string, string> = {}): { ok: boolean; text: string } {
  const calc = CLONING_CALCS.find((c) => c.id === id)!;
  const vals: Record<string, string> = {};
  for (const f of calc.fields) vals[f.key] = f.default;
  Object.assign(vals, over);
  const out = calc.compute((k) => vals[k] ?? "");
  return { ok: out.ok !== false, text: out.text ?? "" };
}

const rc = (s: string): string =>
  s
    .split("")
    .reverse()
    .map((c) => ({ A: "T", T: "A", G: "C", C: "G" })[c] ?? "N")
    .join("");

const rotate = (s: string, k: number): string => s.slice(k % s.length) + s.slice(0, k % s.length);

// ------------------------------------------------------------- the fixtures

/** pUC19 with its single native BsaI site domesticated: GAGACC -> GAGACG at 1766. */
const PUC19_BSAI_FREE = PUC19.slice(0, 1770) + "G" + PUC19.slice(1771);
/**
 * The same, domesticated for BsmBI as well. pUC19 has three native CGTCTC
 * sites, one of them ACROSS THE ORIGIN (2683 of 2686). BsaI's GGTCTC and
 * BsmBI's CGTCTC differ by one base, so each change was chosen (by the oracle)
 * to leave no site of EITHER enzyme behind: bases 2, 56 and 1771.
 */
const PUC19_IIS_FREE = (() => {
  const b = PUC19_BSAI_FREE.split("");
  b[1] = "A";
  b[55] = "A";
  b[1770] = "A";
  return b.join("");
})();

const STUFFER =
  "CATGATTACGGATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTAATC" +
  "GCCTTGCAGCACATCCCCCTTTCGCCAGCTGGCGTAATAGCGAAGAGGCCCGCACCGATCGCCCTTCCCAACAG";

/** [overhang][spacer][inverted site] … [site][spacer][overhang] around a stuffer. */
function cassette(site: string, ov5: string, ov3: string): string {
  return ov5 + "A" + rc(site) + STUFFER + site + "A" + ov3;
}
/** A destination vector: the cassette dropped into the scaffold's lacZα region. */
function destVector(scaffold: string, site: string, ov5: string, ov3: string, at = 400): string {
  return scaffold.slice(0, at) + cassette(site, ov5, ov3) + scaffold.slice(at);
}

const V_BSAI = destVector(PUC19_BSAI_FREE, "GGTCTC", "AATG", "GCTT");
const V_BSMBI = destVector(PUC19_IIS_FREE, "CGTCTC", "TTCG", "ATCC");

const P1 = "AGCAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGGTCATAAATTTTCT";
const P2 = "GTGAGCGGCGAAGGCGAAGGCGATGCGACCTATGGCAAACTGACCCTGAAATTTATTTGCACCACCGGCAAACTGCCGGTG";
const PARTS: Part[] = [
  { name: "p1", seq: P1 },
  { name: "p2", seq: P2 },
];

// ===========================================================================
// PART 1 — the pins. Everything here worked before Release D and must not move.
// ===========================================================================

describe("Release D pins: Golden Gate behaviour that must stay byte-identical", () => {
  // The three defaults of the pane's own calculator.
  test("a parts-only assembly is unchanged", () => {
    const r = run("cloning-golden-gate");
    expect(r.ok).toBe(true);
    expect(r.text.length).toBe(2621);
    expect(sha(r.text)).toBe("a3f08db65d4111c4");
  });

  test("a plain backbone with no sites of the enzyme is unchanged", () => {
    const bb = "TCACCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGGAA";
    const r = run("cloning-golden-gate", { backbone: "vector: " + bb });
    expect(r.ok).toBe(true);
    expect(r.text.length).toBe(2917);
    expect(sha(r.text)).toBe("9a7a4c4605ff47e9");
  });

  // A PLAIN backbone is a fragment whose two pasted ends BECOME the junctions
  // with the parts, so a site spanning the paste position is not in the product
  // at all. That design was correct before and stays byte-identical: only a
  // CIRCULAR reading of the backbone (a destination vector, which is digested
  // rather than amplified) makes such a site real.
  test("a plain backbone whose only site spans the paste position still designs", () => {
    const base = PUC19_BSAI_FREE.slice(0, 400) + "GGTCTCAGCTT" + PUC19_BSAI_FREE.slice(400);
    const wrap = rotate(base, (base.indexOf("GGTCTC") + 3) % base.length);
    expect(findSites(wrap, { only: ["BsaI"] })).toHaveLength(0);
    expect(findSites(wrap, { only: ["BsaI"], circular: true })).toHaveLength(1);
    const r = run("cloning-golden-gate", { parts: `p1: ${P1}\np2: ${P2}`, backbone: `pWRAP: ${wrap}` });
    expect(r.ok).toBe(true);
    expect(r.text.length).toBe(2245);
    expect(sha(r.text)).toBe("843ee2ed224b4d20");
    // Proof that the design is right: the finished product carries no site.
    const g = goldenGate({ parts: PARTS, enzyme: "BsaI", backbone: { name: "pWRAP", seq: wrap } });
    expect(g.ok).toBe(true);
    if (g.ok) expect(findSites(g.productSequence, { only: ["BsaI"], circular: true })).toHaveLength(0);
  });

  test("the engine's answer for the pane defaults is unchanged", () => {
    const parts: Part[] = [
      { name: "promoter", seq: "AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGGCTCGTATAATGTGTGGA" },
      { name: "cds", seq: "GGTTCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGG" },
      { name: "terminator", seq: "GCTTACTCGAGCAAAGGCCCAGTCTTTCGACTGAGCCTTTCGTTTTATTTGATGCCTGGCAGTTCCCTACT" },
    ];
    const r = goldenGate({ parts, enzyme: "BsaI" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.overhangs).toEqual([
      { part: "promoter", seq: "AATG" },
      { part: "cds", seq: "GGTT" },
      { part: "terminator", seq: "GCTT" },
    ]);
    expect(r.productLength).toBe(212);
    expect(r.partLengths).toEqual([70, 71, 71]);
    expect(r.order).toEqual(["promoter", "cds", "terminator"]);
    expect(r.destination).toBeNull();
    expect(r.primers.map((p) => p.seq)).toEqual([
      "GGTCTCAAATGGTCAGTCCTAGGTATAATGCTAGCAA",
      "GGTCTCAAACCTCCACACATTATACGAGCCGGAAGC",
      "GGTCTCAGGTTCTAAAGGCGAAGAACTGTTTACCG",
      "GGTCTCAAAGCCCGTTCACATCACCATCCAGTTCC",
      "GGTCTCAGCTTACTCGAGCAAAGGCCCAG",
      "GGTCTCACATTAGTAGGGAACTGCCAGGCATCAAA",
    ]);
  });

  test.each([
    [
      "a palindromic fusion site",
      [
        { name: "a", seq: "AATTCGGCGAAGAACTGTTTACCGGCGTTGTGCCG" },
        { name: "b", seq: "GGTTCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCG" },
      ],
      "The fusion site of “a” is AATT, which is its own reverse complement (palindromic). A palindromic overhang " +
        "ligates to a second copy of itself in either orientation, so the assembly scrambles. Shift the junction by a " +
        "base or two.",
    ],
    [
      "a site inside a PART keeps the domestication advice, which is right there",
      [
        { name: "a", seq: "ACGTGGTCTCAAGGCGAAGAACTGTTTACCGGCGTTGTGCCG" },
        { name: "b", seq: "GGTTCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCG" },
      ],
      "“a” contains 1 internal BsaI site (GGTCTC) at position 5 on the forward strand. BsaI would cut inside the part " +
        "during the assembly, so this design cannot work: domesticate the site (a silent change) or use a different " +
        "Type IIS enzyme.",
    ],
  ])("refusal unchanged: %s", (_what, parts, error) => {
    const r = goldenGate({ parts: parts as Part[], enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(error);
  });

  test("a part's own site is still reported before the backbone is read", () => {
    const r = goldenGate({
      parts: [
        { name: "a", seq: "ACGTGGTCTCAAGGCGAAGAACTGTTTACCGGCGTTGTGCCG" },
        { name: "b", seq: "GGTTCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCG" },
      ],
      enzyme: "BsaI",
      backbone: { name: "pDEST", seq: V_BSAI },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^“a” contains 1 internal BsaI site/);
  });
});

// ===========================================================================
// PART 2 — the destination vector, against Biopython.
// ===========================================================================

describe("the fixtures are what the oracle digested", () => {
  test("pUC19 carries one native BsaI site and two BsmBI sites, one across the origin", () => {
    const bsa = findSites(PUC19, { only: ["BsaI"], circular: true });
    expect(bsa.map((h) => [h.position, h.strand])).toEqual([[1766, -1]]);
    const bsm = findSites(PUC19, { only: ["BsmBI"], circular: true });
    expect(bsm.map((h) => [h.position, h.strand])).toEqual([
      [51, -1],
      [2683, 1],
    ]);
    // 2683 + 6 - 1 = 2688 > 2686: that one spans the origin, and a LINEAR
    // search of the same sequence never sees it.
    expect(PUC19.length).toBe(2686);
    expect(findSites(PUC19, { only: ["BsmBI"] }).map((h) => h.position)).toEqual([51]);
  });

  // Worth its own row: BsaI's GGTCTC and BsmBI's CGTCTC differ by one base, so
  // domesticating the BsaI site (GAGACC -> GAGACG) CREATES a BsmBI site where
  // there was none. The oracle hit this, which is why the BsmBI scaffold is
  // domesticated with changes checked against both enzymes.
  test("domesticating for BsaI creates a BsmBI site at the same place", () => {
    expect(findSites(PUC19_BSAI_FREE, { only: ["BsmBI"], circular: true }).map((h) => h.position)).toEqual([
      51,
      1766,
      2683,
    ]);
  });

  test("the domesticated scaffolds carry no Type IIS site at all", () => {
    expect(findSites(PUC19_BSAI_FREE, { only: ["BsaI"], circular: true })).toHaveLength(0);
    expect(findSites(PUC19_IIS_FREE, { only: ["BsaI"], circular: true })).toHaveLength(0);
    expect(findSites(PUC19_IIS_FREE, { only: ["BsmBI"], circular: true })).toHaveLength(0);
    expect(PUC19_BSAI_FREE.length).toBe(2686);
    expect(PUC19_IIS_FREE.length).toBe(2686);
  });

  // Bio.Restriction: BsaI.search(VECTOR, linear=False) -> [401, 567], i.e. the
  // cuts fall AFTER bases 400 and 566. enzymes.ts reports the base before each
  // cut, so 400 and 566 is agreement to the base.
  test("enzymes.ts finds the same two sites and the same cuts as Bio.Restriction", () => {
    expect(V_BSAI.length).toBe(2856);
    const hits = findSites(V_BSAI, { only: ["BsaI"], circular: true });
    expect(hits.map((h) => [h.position, h.strand, h.cutPosition])).toEqual([
      [406, -1, 400],
      [560, 1, 566],
    ]);
  });
});

describe("destinationVector: the geometry, against Biopython's digest", () => {
  test("the dropout, the body and both overhangs are the oracle's", () => {
    const d = destinationVector(V_BSAI, BSAI, "pDEST");
    expect("ok" in d).toBe(false);
    if ("ok" in d) return;
    expect(d.body.length).toBe(2690); // Bio.Restriction fragment 1
    expect(d.dropout).toEqual({ start: 401, end: 566, length: 166, wraps: false });
    expect(d.overhang5).toBe("GCTT"); // the body's own first 4 bases
    expect(d.overhang3).toBe("AATG"); // the dropout's first 4 bases
    expect(d.body.slice(0, 4)).toBe("GCTT");
    expect(d.sites).toEqual([
      { position: 406, strand: -1, cut: 400 },
      { position: 560, strand: 1, cut: 566 },
    ]);
    expect(d.summary).toBe(
      "Destination vector: BsaI sites at 406 and 560 (inverted), dropout 401–566 (166 bp) removed, " +
        "vector overhangs GCTT (5′) and AATG (3′).",
    );
    // The body is the plasmid minus the dropout, and carries no site.
    expect(d.body.length + d.dropout.length).toBe(V_BSAI.length);
    expect(findSites(d.body, { only: ["BsaI"] })).toHaveLength(0);
  });

  // The user may paste the same plasmid starting anywhere. Biopython gave the
  // identical body and overhangs at all eight of these rotations; 403 and 406
  // put a BsaI site across the origin.
  test.each([0, 1, 2, 403, 404, 406, 2848, 2853])("rotation %i gives the same vector body", (k) => {
    const d = destinationVector(rotate(V_BSAI, k), BSAI, "pDEST");
    expect("ok" in d).toBe(false);
    if ("ok" in d) return;
    expect(d.body.length).toBe(2690);
    expect(d.overhang5).toBe("GCTT");
    expect(d.overhang3).toBe("AATG");
    expect(d.dropout.length).toBe(166);
  });

  test("a site across the origin is found and read like any other", () => {
    const k = 406;
    const hits = findSites(rotate(V_BSAI, k), { only: ["BsaI"], circular: true });
    // One of the two sites now starts at 2856 and runs over the origin.
    expect(hits.map((h) => h.position).sort((a, b) => a - b)).toEqual([154, 2856]);
    expect(findSites(rotate(V_BSAI, k), { only: ["BsaI"] })).toHaveLength(1);
    const d = destinationVector(rotate(V_BSAI, k), BSAI, "pDEST");
    if ("ok" in d) throw new Error(d.error);
    expect(d.dropout.wraps).toBe(true);
    expect(d.summary).toContain("wrapping the start of the sequence as pasted");
  });

  test("BsmBI: the same geometry read from the same table", () => {
    const d = destinationVector(V_BSMBI, BSMBI, "pDEST2");
    if ("ok" in d) throw new Error(d.error);
    expect(d.body.length).toBe(2690);
    expect(d.dropout.length).toBe(166);
    expect(d.overhang5).toBe("ATCC");
    expect(d.overhang3).toBe("TTCG");
  });
});

describe("goldenGate with a destination vector", () => {
  const r = goldenGate({ parts: PARTS, enzyme: "BsaI", backbone: { name: "pDEST", seq: V_BSAI } });

  test("it designs instead of refusing, and says what it read", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.destination).not.toBeNull();
    expect(r.order).toEqual(["p1", "p2", "pDEST"]);
  });

  test("the product is the vector body plus the parts, and Biopython's length", () => {
    if (!r.ok) return;
    const body = (() => {
      const d = destinationVector(V_BSAI, BSAI, "pDEST");
      return "ok" in d ? "" : d.body;
    })();
    // The oracle's ligation, in this engine's order (parts first, backbone last).
    expect(r.productSequence).toBe("AATG" + P1 + P2 + body);
    expect(r.productLength).toBe(2856);
    expect(r.productLength).toBe(body.length + 4 + P1.length + P2.length);
    expect(r.partLengths).toEqual([85, 81, 2690]);
  });

  test("the finished plasmid carries no site of the enzyme that built it", () => {
    if (!r.ok) return;
    expect(findSites(r.productSequence, { only: ["BsaI"], circular: true })).toHaveLength(0);
  });

  test("the vector gets no primers, and the first part's tail carries the vector's overhang", () => {
    if (!r.ok) return;
    expect(r.primers.map((p) => p.name)).toEqual(["p1 forward", "p1 reverse", "p2 forward", "p2 reverse"]);
    const fwd = r.primers[0];
    expect(fwd.tail).toBe("GGTCTCA" + "AATG");
    expect(fwd.anneal.startsWith(P1.slice(0, 10))).toBe(true);
    // The last part's reverse primer presents the vector's own 5′ overhang.
    expect(r.primers[3].tail).toBe("GGTCTCA" + rc("GCTT"));
  });

  test("the four overhangs in the ligation are the vector's two and the parts'", () => {
    if (!r.ok) return;
    expect(r.overhangs).toEqual([
      { part: "p1", seq: "AATG" },
      { part: "p2", seq: "GTGA" },
      { part: "pDEST", seq: "GCTT" },
    ]);
  });

  test("a part that ALREADY carries the vector's overhang is not given it twice", () => {
    const lib: Part[] = [{ name: "p1", seq: "AATG" + P1.slice(4) }, { name: "p2", seq: P2 }];
    const g = goldenGate({ parts: lib, enzyme: "BsaI", backbone: { name: "pDEST", seq: V_BSAI } });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.primers[0].tail).toBe("GGTCTCA");
    expect(g.partLengths).toEqual([81, 81, 2690]);
    expect(g.productSequence.startsWith("AATG" + P1.slice(4, 20))).toBe(true);
    expect(g.productSequence).not.toContain("AATGAATG");
    expect(g.notes.join(" ")).toContain("already begins with AATG");
  });

  test("BsmBI end to end", () => {
    const g = goldenGate({ parts: PARTS, enzyme: "BsmBI", backbone: { name: "pDEST2", seq: V_BSMBI } });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.destination?.overhang5).toBe("ATCC");
    expect(g.destination?.overhang3).toBe("TTCG");
    expect(g.primers[0].tail).toBe("CGTCTCA" + "TTCG");
    expect(findSites(g.productSequence, { only: ["BsmBI"], circular: true })).toHaveLength(0);
  });

  test("the pane reports it in the house style", () => {
    const out = run("cloning-golden-gate", { parts: `p1: ${P1}\np2: ${P2}`, backbone: `pDEST: ${V_BSAI}` });
    expect(out.ok).toBe(true);
    expect(out.text).toContain(
      "Destination vector: BsaI sites at 406 and 560 (inverted), dropout 401–566 (166 bp) removed, " +
        "vector overhangs GCTT (5′) and AATG (3′).",
    );
    expect(out.text).toContain("AATG (the vector's 3′ overhang, carried on the “p1” forward primer)");
    expect(out.text).toContain("The vector is digested, not amplified: it gets no primers.");
    // Display contract: no em dash, no carets, no e-notation, no NaN.
    expect(out.text).not.toMatch(/—|\^|NaN|Infinity|undefined|\d[eE][+-]\d/);
  });
});

describe("every other arrangement of sites in the backbone is a NAMED refusal", () => {
  const withBackbone = (seq: string, enzyme = "BsaI"): string => {
    const r = goldenGate({ parts: PARTS, enzyme, backbone: { name: "pBB", seq } });
    return r.ok ? "DESIGNED" : r.error;
  };

  test("one site: it would only linearise the plasmid", () => {
    const one = PUC19_BSAI_FREE.slice(0, 400) + "GGTCTCAGCTT" + PUC19_BSAI_FREE.slice(400);
    const e = withBackbone(one);
    expect(e).toContain("needs exactly two BsaI sites (GGTCTC) facing away from each other around the dropout");
    expect(e).toContain("“pBB” has ONE, at 401 (forward strand)");
    expect(e).toContain("simply linearise the plasmid");
    expect(e).not.toContain("domesticate the site (a silent change)");
    expect(e).toContain("domesticate that site instead");
  });

  test("a refusal reaches Word under the display contract", () => {
    const one = PUC19_BSAI_FREE.slice(0, 400) + "GGTCTCAGCTT" + PUC19_BSAI_FREE.slice(400);
    const out = run("cloning-golden-gate", { parts: `p1: ${P1}\np2: ${P2}`, backbone: `pBB: ${one}` });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/needs exactly two BsaI sites/);
    expect(out.text).not.toMatch(/—|\^|NaN|Infinity|undefined|\d[eE][+-]\d/);
  });

  test("three sites: the vector body comes apart", () => {
    const three =
      PUC19_BSAI_FREE.slice(0, 400) + cassette("GGTCTC", "AATG", "GCTT") + "TTGGTCTCAGGAG" + PUC19_BSAI_FREE.slice(400);
    const e = withBackbone(three);
    expect(e).toContain("“pBB” has 3, at 406 (reverse strand), 560 (forward strand), 573 (forward strand)");
    expect(e).toContain("the vector body itself comes apart into pieces");
  });

  test("two sites in the SAME orientation: one of them stays behind", () => {
    const same =
      PUC19_BSAI_FREE.slice(0, 400) +
      "GGTCTCAGCTT" +
      STUFFER +
      "GGTCTCAAATG" +
      PUC19_BSAI_FREE.slice(400);
    const e = withBackbone(same);
    expect(e).toContain("are in the SAME orientation");
    expect(e).toContain("one site stays on the vector body and only the other leaves with the dropout");
    expect(e).toContain("INVERTED");
  });

  test("two inverted sites too close: one straddles the other's cut", () => {
    const tight = PUC19_BSAI_FREE.slice(0, 400) + "GGTCTCGAGACC" + PUC19_BSAI_FREE.slice(400);
    const e = withBackbone(tight);
    expect(e).toContain("inverted but too close together");
    expect(e).toContain("neither piece carries both sites whole");
  });

  test("nothing left to clone into: the kept piece is shorter than its own overhang", () => {
    const tiny = "AAAAAAA" + "GAGACC" + "AA" + "GGTCTC" + "AAA";
    expect(tiny.length).toBe(24);
    const e = withBackbone(tiny);
    expect(e).toContain("the piece that would be KEPT is only 4 bp");
    expect(e).toContain("no vector body to clone into");
  });

  test("the refusals never tell the user to domesticate a destination vector", () => {
    const cases = [
      PUC19_BSAI_FREE.slice(0, 400) + "GGTCTCAGCTT" + PUC19_BSAI_FREE.slice(400),
      PUC19_BSAI_FREE.slice(0, 400) + "GGTCTCAGCTT" + STUFFER + "GGTCTCAAATG" + PUC19_BSAI_FREE.slice(400),
    ];
    for (const c of cases) {
      const e = withBackbone(c);
      expect(e).not.toMatch(/would cut inside the part during the assembly/);
    }
  });

  test("a Type IIS enzyme that leaves no 5′ overhang is still refused up front", () => {
    const r = goldenGate({ parts: PARTS, enzyme: "MlyI", backbone: { name: "pBB", seq: V_BSAI } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("do not describe a 5′ overhang");
  });
});

describe("adversarial", () => {
  test("a palindromic vector overhang is refused rather than scrambled", () => {
    // AATT is its own reverse complement: a vector that offers it cannot hold an
    // orientation.
    const v = destVector(PUC19_BSAI_FREE, "GGTCTC", "AATT", "GCTT");
    const r = goldenGate({ parts: PARTS, enzyme: "BsaI", backbone: { name: "pBB", seq: v } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("palindromic");
  });

  test("a part whose 5′ end collides with the vector's overhang is refused", () => {
    const clash: Part[] = [{ name: "p1", seq: P1 }, { name: "p2", seq: "AATG" + P2.slice(4) }];
    const r = goldenGate({ parts: clash, enzyme: "BsaI", backbone: { name: "pDEST", seq: V_BSAI } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("have the SAME fusion site (AATG)");
  });

  test("a junction that spells a new site is still caught on the destination product", () => {
    // p2 ends so that p2 -> pDEST spells GGTCTC across the junction: the vector
    // body begins GCTT..., so ...GGTC + TC is not it; use the reverse strand
    // spelling by ending p2 with GAGAC and letting GCTT follow -> GAGACC? No:
    // the engine's own check is exercised by a part ending in GGTCT and a
    // following overhang starting with C.
    const v = destVector(PUC19_BSAI_FREE, "GGTCTC", "AATG", "CTTG");
    const d = destinationVector(v, BSAI, "pX");
    if ("ok" in d) throw new Error(d.error);
    expect(d.overhang5).toBe("CTTG");
    const p2b = P2.slice(0, P2.length - 5) + "GGTCT";
    const r = goldenGate({ parts: [{ name: "p1", seq: P1 }, { name: "p2", seq: p2b }], enzyme: "BsaI", backbone: { name: "pX", seq: v } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("SPELLS a new BsaI site");
      expect(r.error).toContain("p2");
    }
  });

  test("a backbone shorter than a fusion site plus an annealing region is refused first", () => {
    const r = goldenGate({ parts: PARTS, enzyme: "BsaI", backbone: { name: "pBB", seq: "GGTCTCAGCTTAAAA" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("too short to carry a 4 nt fusion site");
  });

  test("the destination vector is capped by the same sequence limit as everything else", () => {
    const out = run("cloning-golden-gate", {
      parts: `p1: ${P1}\np2: ${P2}`,
      backbone: `pBig: ${"ACGT".repeat(30_000)}`,
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("100,000");
  });
});

describe("the diagram shows the vector, its overhangs and the dropout", () => {
  test("the vector body is drawn as a box in its own tint, with the dropout in the footer", () => {
    const r = goldenGate({ parts: PARTS, enzyme: "BsaI", backbone: { name: "pDEST", seq: V_BSAI } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = goldenGateSvg(r);
    expect(svg).toContain('fill="#e6f0e6"'); // the vector tint
    expect(svg).toContain('stroke="#2f5d35"');
    // The footer WRAPS across several <text> elements, so it is read back as
    // the concatenated text content rather than as one substring of the markup.
    const words = [...svg.matchAll(/>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
    expect(words).toContain("destination vector “pDEST” (green)");
    expect(words).toContain("dropout 166 bp cut out with both BsaI sites");
    expect(words).toContain("vector overhangs GCTT (5′) and AATG (3′)");
    expect(words).toContain("body 2,690 bp kept");
    // Both overhangs are drawn as junction labels around the vector box.
    expect(svg).toContain(">GCTT</text>");
    expect(svg).toContain(">AATG</text>");
    // No CSS variables or theme colours in inserted artwork.
    expect(svg).not.toMatch(/var\(--|currentColor/);
    // Nothing clipped: every x stays inside the declared width.
    const w = Number(/width="(\d+)"/.exec(svg)![1]);
    for (const m of svg.matchAll(/<text x="([\d.]+)"/g)) expect(Number(m[1])).toBeLessThanOrEqual(w);
  });

  test("a diagram without a destination vector is byte-identical", () => {
    const r = goldenGate({ parts: PARTS, enzyme: "BsaI" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = goldenGateSvg(r);
    expect(svg).not.toContain("#e6f0e6");
    expect(svg).not.toContain("destination vector");
    // Pinned against the pre-Release-D renderer: goldenGateSvg for this input was
    // rendered with git HEAD:src/lib/cloningCharts.ts side by side with this one
    // and the two strings were identical.
    expect(sha(svg)).toBe("5f66d6415ca03d6a");
  });
});
