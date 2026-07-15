// Restriction enzyme tests.
//
// The dangerous failure here is a MISSED site, not a crash: if BsaI has an extra
// site you didn't know about, your Golden Gate assembly fails at the bench and
// nothing tells you why. So the emphasis is on the asymmetric enzymes, whose
// reverse-strand sites a forward-only search never sees — which is exactly what
// the old string-matching engine did.

import {
  ENZYMES,
  findSites,
  summarise,
  uniqueCutters,
  isPalindromic,
  reverseComplementIupac,
  overhangOf,
  formatSite,
  IUPAC,
} from "../enzymes";

const rc = reverseComplementIupac;

describe("the table is sane", () => {
  test("every enzyme has a name and a site", () => {
    for (const e of ENZYMES) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.site.length).toBeGreaterThan(0);
    }
  });

  test("every site uses only IUPAC codes", () => {
    for (const e of ENZYMES) {
      for (const c of e.site) expect(IUPAC[c]).toBeDefined();
    }
  });

  test("cut offsets are sane", () => {
    for (const e of ENZYMES) {
      expect(e.cutTop).toBeGreaterThanOrEqual(0);
      expect(e.cutBottom).toBeGreaterThanOrEqual(0);
      // A Type IIS enzyme cuts past its site; a Type II cuts within it.
      if (!e.typeIIS) {
        expect(e.cutTop).toBeLessThanOrEqual(e.site.length);
        expect(e.cutBottom).toBeLessThanOrEqual(e.site.length);
      } else {
        expect(e.cutTop).toBeGreaterThan(e.site.length - 1);
      }
    }
  });

  test("enzyme names are unique", () => {
    const names = ENZYMES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("the set is meaningfully bigger than the old 49", () => {
    expect(ENZYMES.length).toBeGreaterThan(90);
  });

  test("it includes the Type IIS enzymes Golden Gate depends on", () => {
    for (const n of ["BsaI", "BsmBI", "BbsI", "SapI", "Esp3I", "BspQI"]) {
      expect(ENZYMES.some((e) => e.name === n)).toBe(true);
    }
  });

  test("it includes degenerate-site enzymes a string search can't find", () => {
    for (const n of ["BstXI", "SfiI", "DraIII", "AlwNI", "XcmI", "BglI"]) {
      const e = ENZYMES.find((x) => x.name === n)!;
      expect(e).toBeDefined();
      expect(/N/.test(e.site)).toBe(true);
    }
  });
});

describe("recognition sequences match the published facts", () => {
  // Spot-checks against supplier documentation. These are the sequences every
  // catalogue and textbook publishes; getting one wrong would silently produce
  // wrong maps and failed digests.
  const KNOWN: [string, string, number, number][] = [
    // name, site, cutTop, cutBottom
    ["EcoRI", "GAATTC", 1, 5],
    ["BamHI", "GGATCC", 1, 5],
    ["HindIII", "AAGCTT", 1, 5],
    ["NotI", "GCGGCCGC", 2, 6],
    ["PstI", "CTGCAG", 5, 1],
    ["SmaI", "CCCGGG", 3, 3],
    ["EcoRV", "GATATC", 3, 3],
    ["NdeI", "CATATG", 2, 4],
    ["KpnI", "GGTACC", 5, 1],
    ["SacI", "GAGCTC", 5, 1],
    // Type IIS — confirmed against NEB's Golden Gate documentation.
    ["BsaI", "GGTCTC", 7, 11], // GGTCTC(1/5)
    ["BsmBI", "CGTCTC", 7, 11], // CGTCTC(1/5)
    ["BbsI", "GAAGAC", 8, 12], // GAAGAC(2/6)
  ];

  test.each(KNOWN)("%s = %s", (name, site, cutTop, cutBottom) => {
    const e = ENZYMES.find((x) => x.name === name)!;
    expect(e).toBeDefined();
    expect(e.site).toBe(site);
    expect(e.cutTop).toBe(cutTop);
    expect(e.cutBottom).toBe(cutBottom);
  });

  test("Type IIS cut offsets express the published (N1/N5)-style notation", () => {
    // BsaI is GGTCTC(1/5): 1 nt past the 6 bp site on top, 5 on the bottom.
    const bsa = ENZYMES.find((e) => e.name === "BsaI")!;
    expect(bsa.cutTop - bsa.site.length).toBe(1);
    expect(bsa.cutBottom - bsa.site.length).toBe(5);
    expect(formatSite(bsa)).toBe("GGTCTC(1/5)");
    // BbsI is GAAGAC(2/6).
    const bbs = ENZYMES.find((e) => e.name === "BbsI")!;
    expect(formatSite(bbs)).toBe("GAAGAC(2/6)");
  });

  test("overhangs come out as the literature states", () => {
    const o = (n: string) => overhangOf(ENZYMES.find((e) => e.name === n)!);
    expect(o("EcoRI")).toEqual({ kind: "5'", length: 4 }); // G^AATTC → AATT
    expect(o("PstI")).toEqual({ kind: "3'", length: 4 }); // CTGCA^G
    expect(o("SmaI")).toEqual({ kind: "blunt", length: 0 }); // CCC^GGG
    expect(o("NdeI")).toEqual({ kind: "5'", length: 2 }); // CA^TATG → TA
    expect(o("BsaI").kind).toBe("5'"); // 4 nt 5' overhang
    expect(o("BsaI").length).toBe(4);
    expect(o("BbsI").length).toBe(4);
  });

  test("formatSite renders the ^ notation for Type II enzymes", () => {
    expect(formatSite(ENZYMES.find((e) => e.name === "EcoRI")!)).toBe("G^AATTC");
    expect(formatSite(ENZYMES.find((e) => e.name === "SmaI")!)).toBe("CCC^GGG");
    expect(formatSite(ENZYMES.find((e) => e.name === "PstI")!)).toBe("CTGCA^G");
  });
});

describe("IUPAC matching — sites a plain string search cannot find", () => {
  test("N matches any base", () => {
    // DraIII is CACNNNGTG. A string search for that literal finds nothing.
    const seq = "AAAA" + "CACAAAGTG" + "TTTT";
    const hits = findSites(seq, { only: ["DraIII"] });
    expect(hits).toHaveLength(1);
    expect(hits[0].position).toBe(5);
  });

  test("N matches a DIFFERENT filler too — it's not a literal", () => {
    for (const filler of ["AAA", "GGG", "CTG", "TAC"]) {
      const hits = findSites("AAAA" + "CAC" + filler + "GTG" + "TTTT", { only: ["DraIII"] });
      expect(hits).toHaveLength(1);
    }
  });

  test("W matches A or T, and nothing else", () => {
    // StyI is CCWWGG.
    expect(findSites("CCAAGG", { only: ["StyI"] })).toHaveLength(1);
    expect(findSites("CCTTGG", { only: ["StyI"] })).toHaveLength(1);
    expect(findSites("CCATGG", { only: ["StyI"] })).toHaveLength(1);
    expect(findSites("CCGCGG", { only: ["StyI"] })).toHaveLength(0);
  });

  test("R/Y match purines/pyrimidines", () => {
    // BsaAI is YACGTR.
    expect(findSites("CACGTA", { only: ["BsaAI"] })).toHaveLength(1); // C=Y, A=R
    expect(findSites("TACGTG", { only: ["BsaAI"] })).toHaveLength(1); // T=Y, G=R
    expect(findSites("AACGTA", { only: ["BsaAI"] })).toHaveLength(0); // A is not Y
  });

  test("a long interrupted site matches (BstXI, 12 bp with 6 Ns)", () => {
    const hits = findSites("TTTT" + "CCAGGGCCCTGG" + "AAAA", { only: ["BstXI"] });
    expect(hits).toHaveLength(1);
    expect(hits[0].position).toBe(5);
  });
});

describe("BOTH strands are searched — the correctness bug this fixes", () => {
  // Every one of the old 49 enzymes was palindromic, so a forward-only search
  // happened to work. Every Type IIS enzyme is asymmetric, so the same search
  // would silently miss half its sites.

  test("BsaI is asymmetric — the premise of this whole section", () => {
    const bsa = ENZYMES.find((e) => e.name === "BsaI")!;
    expect(isPalindromic(bsa.site)).toBe(false);
    expect(rc("GGTCTC")).toBe("GAGACC");
  });

  test("a BsaI site on the REVERSE strand is found", () => {
    // GAGACC is the reverse complement of GGTCTC — a forward-only search sees
    // nothing here, and the user's Golden Gate silently fails at the bench.
    const hits = findSites("AAAA" + "GAGACC" + "TTTT", { only: ["BsaI"] });
    expect(hits).toHaveLength(1);
    expect(hits[0].strand).toBe(-1);
    expect(hits[0].position).toBe(5);
  });

  test("BsaI sites on both strands are both found", () => {
    const hits = findSites("GGTCTC" + "AAAAAAAAAA" + "GAGACC", { only: ["BsaI"] });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.strand).sort()).toEqual([-1, 1]);
  });

  test("a palindromic enzyme is NOT double-counted", () => {
    // EcoRI reads GAATTC on both strands. Searching both naively would report
    // every site twice and make every enzyme look like a non-unique cutter.
    const hits = findSites("AAAA" + "GAATTC" + "TTTT", { only: ["EcoRI"] });
    expect(hits).toHaveLength(1);
  });

  test("every asymmetric enzyme finds its own reverse site", () => {
    // A sweep: for each non-palindromic enzyme, plant its reverse complement and
    // confirm it's found. This is the general form of the bug.
    const asym = ENZYMES.filter((e) => !isPalindromic(e.site) && !/[NRYWSKMBDHV]/.test(e.site));
    expect(asym.length).toBeGreaterThan(5);
    for (const e of asym) {
      const seq = "AAAAAAAA" + rc(e.site) + "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT";
      const hits = findSites(seq, { only: [e.name] });
      const rev = hits.filter((h) => h.strand === -1);
      expect(rev.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("finding sites", () => {
  test("reports 1-based positions", () => {
    const hits = findSites("GAATTC", { only: ["EcoRI"] });
    expect(hits[0].position).toBe(1);
  });

  test("finds every occurrence, including overlapping ones", () => {
    // AluI is AGCT; AGCTAGCT contains two.
    const hits = findSites("AGCTAGCT", { only: ["AluI"] });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.position)).toEqual([1, 5]);
  });

  test("no sites → no hits, not an error", () => {
    expect(findSites("AAAAAAAAAA", { only: ["EcoRI"] })).toEqual([]);
  });

  test("empty input is safe", () => {
    expect(findSites("")).toEqual([]);
    expect(findSites("   ")).toEqual([]);
  });

  test("whitespace and numbering are ignored", () => {
    expect(findSites("  1 gaat tc ", { only: ["EcoRI"] })).toHaveLength(1);
  });

  test("lower case works", () => {
    expect(findSites("gaattc", { only: ["EcoRI"] })).toHaveLength(1);
  });

  test("a circular molecule finds a site spanning the origin", () => {
    // TTC…GAA: the EcoRI site straddles the join.
    const seq = "TTCAAAAAAAAAAAAAAAAAAGAA"; // ends GAA, starts TTC → GAATTC across the origin
    expect(findSites(seq, { only: ["EcoRI"] })).toHaveLength(0); // linear: not there
    const circ = findSites(seq, { only: ["EcoRI"], circular: true });
    expect(circ.length).toBeGreaterThanOrEqual(1);
  });

  test("a linear molecule does NOT wrap", () => {
    const seq = "TTCAAAAAAAAAAAAAAAAAAGAA";
    expect(findSites(seq, { only: ["EcoRI"], circular: false })).toHaveLength(0);
  });

  test("searching all enzymes at once works and stays ordered", () => {
    const hits = findSites("GAATTCGGATCCAAGCTT");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].position).toBeGreaterThanOrEqual(hits[i - 1].position);
    }
  });
});

describe("summarise and uniqueCutters", () => {
  test("groups by enzyme with counts and positions", () => {
    const s = summarise(findSites("GAATTCAAAAGAATTC", { only: ["EcoRI"] }));
    expect(s).toHaveLength(1);
    expect(s[0].count).toBe(2);
    expect(s[0].positions).toEqual([1, 11]);
  });

  test("unique cutters are exactly those cutting once", () => {
    // EcoRI twice, BamHI once → only BamHI is a unique cutter.
    const hits = findSites("GAATTCGGATCCAAAAGAATTC", { only: ["EcoRI", "BamHI"] });
    expect(uniqueCutters(hits)).toEqual(["BamHI"]);
  });

  test("unique cutters on a real-ish vector are plausible", () => {
    const seq = "GAATTC" + "A".repeat(200) + "GGATCC" + "T".repeat(200) + "AAGCTT" + "G".repeat(100);
    const u = uniqueCutters(findSites(seq));
    expect(u).toContain("EcoRI");
    expect(u).toContain("BamHI");
    expect(u).toContain("HindIII");
  });
});

describe("robustness", () => {
  test("never throws on hostile input", () => {
    for (const s of ["", "N".repeat(500), "ACGT".repeat(2000), "!!!", "acgtRYSWKM", "1234"]) {
      expect(() => findSites(s)).not.toThrow();
    }
  });

  test("a sequence of all Ns does not match everything", () => {
    // N in the SEQUENCE is unknown, not a wildcard: a site must not be claimed
    // where the bases aren't actually known.
    expect(findSites("N".repeat(50), { only: ["EcoRI"] })).toHaveLength(0);
  });

  test("a long sequence stays fast", () => {
    const seq = "ACGTAGCTAGCTAGGATCCTAGCTAGCTA".repeat(400); // ~11 kb
    const t0 = Date.now();
    const hits = findSites(seq);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(hits.length).toBeGreaterThan(0);
  });

  test("reverseComplementIupac handles ambiguity codes", () => {
    expect(rc("GAATTC")).toBe("GAATTC"); // palindrome
    expect(rc("GGTCTC")).toBe("GAGACC");
    expect(rc("CCWWGG")).toBe("CCWWGG"); // W↔W
    expect(rc("YACGTR")).toBe("YACGTR"); // Y↔R
    expect(rc("N")).toBe("N");
  });

  test("isPalindromic agrees with the table's own shape", () => {
    expect(isPalindromic("GAATTC")).toBe(true);
    expect(isPalindromic("GGTCTC")).toBe(false);
    expect(isPalindromic("CACNNNGTG")).toBe(true);
  });
});
