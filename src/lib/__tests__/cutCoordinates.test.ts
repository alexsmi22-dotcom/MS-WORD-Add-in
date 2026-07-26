// Regression: restriction cut coordinates were wrong on the reverse strand and
// fabricated on linear molecules.
//
// (a) The reverse-strand top-strand cut was computed with cutTop where it needs
//     cutBottom. On a reverse-orientation site the enzyme is bound the other way
//     round, so ITS bottom-strand cut is the one landing on the molecule's top
//     strand. Every reverse hit was out by the overhang length, and the error
//     inverted for 3'-overhang cutters. Every Golden Gate enzyme was affected.
//
// (b) The 1-based coordinate was wrapped modulo the sequence length regardless of
//     topology, so a cut falling past the end of a LINEAR molecule was reported
//     as an in-range position that does not exist.

import { findSites, ENZYMES } from "../enzymes";

const bsaI = ENZYMES.find((e) => e.name === "BsaI")!;

describe("reverse-strand cuts use the mirrored bottom-strand offset", () => {
  test("BsaI is the Type IIS case the bug was found on", () => {
    // GGTCTC(1/5): cutTop 7, cutBottom 11, 4 nt 5' overhang.
    expect(bsaI.cutTop).toBe(7);
    expect(bsaI.cutBottom).toBe(11);
  });

  test("a forward BsaI site cuts downstream of the recognition sequence", () => {
    //            1234567890
    const seq = "AAGGTCTCAAAAAAAAAAAA";
    const hit = findSites(seq, { only: ["BsaI"] }).find((h) => h.strand === 1)!;
    expect(hit).toBeDefined();
    expect(hit.position).toBe(3); // GGTCTC starts at 1-based 3
    // i = 2 (0-based), cut = 2 + 7 = 9
    expect(hit.cutPosition).toBe(9);
  });

  test("a reverse BsaI site cuts UPSTREAM, at the mirrored offset", () => {
    // reverse complement of GGTCTC is GAGACC
    const seq = "AAAAAAAAAAGAGACCAAAA";
    const hit = findSites(seq, { only: ["BsaI"] }).find((h) => h.strand === -1)!;
    expect(hit).toBeDefined();
    expect(hit.position).toBe(11); // GAGACC starts at 1-based 11
    // i = 10, cut = 10 + 6 - 11 = 5.  The old code gave 10 + 6 - 7 = 9.
    expect(hit.cutPosition).toBe(5);
    expect(hit.cutPosition).not.toBe(9);
  });

  test("the forward and reverse cuts are mirror images about the site", () => {
    // Same site, same distance from it, opposite side.
    const fwd = findSites("AAGGTCTCAAAAAAAAAAAA", { only: ["BsaI"] }).find((h) => h.strand === 1)!;
    const rev = findSites("AAAAAAAAAAGAGACCAAAA", { only: ["BsaI"] }).find((h) => h.strand === -1)!;
    expect(fwd.cutPosition! - fwd.position).toBe(6); // 9 - 3
    expect(rev.position - rev.cutPosition!).toBe(6); // 11 - 5
  });
});

describe("linear molecules do not invent a cut that falls off the end", () => {
  test("MboI at the very start of a linear sequence reports no top-strand cut", () => {
    // MboI is ^GATC — cutTop 0, so the cut is before base 1: outside a linear molecule.
    const hits = findSites("GATCAAAAAAAAAAAAAAAAAAAA", { only: ["MboI"] });
    const first = hits.find((h) => h.position === 1)!;
    expect(first).toBeDefined();
    expect(first.cutPosition).toBeNull(); // old code reported 24
  });

  test("the same site on a circular molecule does wrap", () => {
    const hits = findSites("GATCAAAAAAAAAAAAAAAAAAAA", { only: ["MboI"], circular: true });
    const first = hits.find((h) => h.position === 1)!;
    expect(first.cutPosition).toBe(24);
  });

  test("a Type IIS site near the 3' end of a linear molecule reports no cut", () => {
    // BsaI needs 7 bases past the site start; place it so the cut runs off the end.
    const seq = "AAAAAAAAAAAAAAGGTCTC";
    const hit = findSites(seq, { only: ["BsaI"] }).find((h) => h.strand === 1)!;
    expect(hit).toBeDefined();
    expect(hit.cutPosition).toBeNull();
  });

  test("an ordinary interior cut is still reported normally", () => {
    const hits = findSites("AAAAGAATTCAAAA", { only: ["EcoRI"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].cutPosition).not.toBeNull();
    expect(hits[0].cutPosition).toBe(5); // G^AATTC at 1-based 5, cutTop 1 -> i=4, cut=5
  });
});

describe("every reported cut is inside the molecule", () => {
  test("across the whole enzyme table, on a linear sequence", () => {
    const seq =
      "GGTCTCAGAATTCGGATCCAAGCTTGTCGACTCTAGAGATCTACTAGTGCTAGCGAGACCCGTCTCGAAGACGCTCTTCAAAA";
    const hits = findSites(seq);
    expect(hits.length).toBeGreaterThan(5); // the fixture really does hit things
    for (const h of hits) {
      if (h.cutPosition !== null) {
        expect(h.cutPosition).toBeGreaterThanOrEqual(1);
        expect(h.cutPosition).toBeLessThanOrEqual(seq.length);
      }
    }
  });
});
