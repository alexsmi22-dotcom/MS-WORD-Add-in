import {
  cleanDna,
  complement,
  reverseComplement,
  transcribe,
  resolveCodon,
  translate,
  baseStats,
  findOrfs,
  buildOrfTableHtml,
  primerTm,
  restrictionSites,
  proteinProperties,
} from "../dna";

describe("cleanDna", () => {
  it("strips non-letters, uppercases, and keeps IUPAC bases", () => {
    const r = cleanDna(" atg 123 cn\t");
    expect(r.seq).toBe("ATGCN");
    expect(r.invalid).toEqual([]);
  });

  it("reports distinct invalid characters", () => {
    const r = cleanDna("atcg-zxq");
    expect(r.seq).toBe("ATCG");
    expect(r.invalid.sort()).toEqual(["Q", "X", "Z"]);
  });
});

describe("complement / reverseComplement", () => {
  it("complements IUPAC bases", () => {
    expect(complement("ATGC")).toBe("TACG");
    expect(complement("RYSWKM")).toBe("YRSWMK");
  });

  it("reverse-complements a strand 5'→3'", () => {
    expect(reverseComplement("ATGGCCTAA")).toBe("TTAGGCCAT");
  });

  it("maps unknown bases to N", () => {
    expect(complement("AZ")).toBe("TN");
  });
});

describe("transcribe", () => {
  it("converts a coding strand to mRNA (T→U)", () => {
    expect(transcribe("ATGC")).toBe("AUGC");
  });
});

describe("resolveCodon", () => {
  it("looks up standard codons", () => {
    expect(resolveCodon("ATG")).toBe("M");
    expect(resolveCodon("TAA")).toBe("*");
  });

  it("resolves degenerate codons that map to one amino acid", () => {
    expect(resolveCodon("GCN")).toBe("A"); // all GCx → Ala
    expect(resolveCodon("CTN")).toBe("L"); // all CTx → Leu
  });

  it("returns X for ambiguous codons spanning multiple amino acids", () => {
    expect(resolveCodon("ATN")).toBe("X"); // ATT/ATC/ATA = I but ATG = M
    expect(resolveCodon("ZZZ")).toBe("X");
  });
});

describe("translate", () => {
  it("translates in frame 1 with stops as *", () => {
    expect(translate("ATGGCCTAA")).toBe("MA*");
  });

  it("can stop at the first stop codon", () => {
    expect(translate("ATGGCCTAAGGG", { stopAtStop: true })).toBe("MA");
  });

  it("honors the reading frame", () => {
    expect(translate("GATGGCCTAA", { frame: 2 })).toBe("MA*");
  });

  it("accepts RNA (U) and resolves degenerate codons", () => {
    expect(translate("AUGGCN")).toBe("MA");
  });

  it("ignores an incomplete trailing codon", () => {
    expect(translate("ATGGC")).toBe("M");
  });
});

describe("baseStats", () => {
  it("counts bases and computes GC/AT, counting U as T", () => {
    const s = baseStats("ATGGCCTAA");
    expect(s.length).toBe(9);
    expect([s.a, s.c, s.g, s.t]).toEqual([3, 2, 2, 2]);
    expect(s.gcPercent).toBeCloseTo(44.444, 2);
  });

  it("counts ambiguous bases as 'other', excluded from GC", () => {
    const s = baseStats("ATGCN");
    expect(s.other).toBe(1);
    expect(s.gcPercent).toBeCloseTo(50, 5);
  });

  it("handles an empty sequence without dividing by zero", () => {
    expect(baseStats("").gcPercent).toBe(0);
  });
});

describe("findOrfs", () => {
  it("finds a forward ORF with 1-based coordinates", () => {
    const orfs = findOrfs("ATGGCCTAA", { includeReverse: false });
    expect(orfs).toEqual([
      { strand: "+", frame: 1, start: 1, end: 9, nt: 9, aa: 2, protein: "MA" },
    ]);
  });

  it("finds a reverse-strand ORF mapped to + coordinates", () => {
    // reverse complement of ATGAAATAA (M K *)
    const orfs = findOrfs("TTATTTCAT");
    const minus = orfs.find((o) => o.strand === "-");
    expect(minus).toMatchObject({ strand: "-", start: 1, end: 9, protein: "MK" });
  });

  it("filters by minimum amino-acid length", () => {
    expect(findOrfs("ATGTAA", { includeReverse: false, minAa: 2 })).toEqual([]);
    expect(findOrfs("ATGTAA", { includeReverse: false, minAa: 1 })).toHaveLength(1);
  });

  it("can skip the reverse strand", () => {
    const orfs = findOrfs("ATGGCCTAA", { includeReverse: false });
    expect(orfs.every((o) => o.strand === "+")).toBe(true);
  });
});

describe("buildOrfTableHtml", () => {
  it("renders a table with strand, frame, location, length, protein", () => {
    const html = buildOrfTableHtml(findOrfs("ATGGCCTAA", { includeReverse: false }));
    expect(html).toContain("Strand");
    expect(html).toContain("1..9");
    expect(html).toContain("MA");
  });

  it("returns empty string when there are no ORFs", () => {
    expect(buildOrfTableHtml([])).toBe("");
  });
});

describe("primerTm", () => {
  it("uses the Wallace rule for short oligos", () => {
    expect(primerTm("ATGC")).toMatchObject({ length: 4, tm: 12 }); // 2*2 + 4*2
  });
  it("uses the GC% formula for longer oligos and reports GC", () => {
    const r = primerTm("ATGCATGCATGCATGCATGC"); // 20-mer, 50% GC
    expect(r.length).toBe(20);
    expect(r.gcPercent).toBeCloseTo(50, 6);
    expect(r.tm).toBeCloseTo(64.9 + (41 * (10 - 16.4)) / 20, 6);
  });
});

describe("restrictionSites", () => {
  it("finds enzyme sites with 1-based positions", () => {
    const hits = restrictionSites("AAAGAATTCAAAGGATCC");
    const eco = hits.find((h) => h.enzyme === "EcoRI");
    const bam = hits.find((h) => h.enzyme === "BamHI");
    expect(eco).toMatchObject({ site: "GAATTC", positions: [4] });
    expect(bam).toMatchObject({ site: "GGATCC", positions: [13] });
  });
  it("returns [] when no sites are present", () => {
    expect(restrictionSites("AAAAAAAA")).toEqual([]);
  });
  it("reports positions relative to the input even with ambiguous bases", () => {
    const eco = restrictionSites("NNNGAATTC").find((h) => h.enzyme === "EcoRI");
    expect(eco?.positions).toEqual([4]);
  });
});

describe("proteinProperties", () => {
  it("computes MW (glycine ≈ 75.07)", () => {
    expect(proteinProperties("G").mw).toBeCloseTo(75.07, 2);
  });
  it("gives a high pI for basic and low pI for acidic peptides", () => {
    expect(proteinProperties("KKKK").pI).toBeGreaterThan(9.5);
    expect(proteinProperties("DDDD").pI).toBeLessThan(4.5);
  });
  it("uses the EMBOSS pKa set", () => {
    // No ionizable side chains ⇒ pI = mean of the EMBOSS terminal pKa (8.6, 3.6).
    expect(proteinProperties("GAG").pI).toBeCloseTo((8.6 + 3.6) / 2, 2); // 6.10
  });
  it("computes GRAVY (hydrophobic positive, hydrophilic negative)", () => {
    expect(proteinProperties("IIII").gravy).toBeCloseTo(4.5, 6);
    expect(proteinProperties("DDDD").gravy).toBeCloseTo(-3.5, 6);
  });
  it("ignores stops and unknown residues", () => {
    expect(proteinProperties("G*XG").length).toBe(2);
  });
});
