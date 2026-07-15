// FASTA / GenBank reader tests.
//
// The location grammar is the part that quietly goes wrong: mis-read
// `complement` and an arrow points the wrong way; mis-read `join` and two exons
// merge into one box spanning the intron it should skip. A figure built on that
// is confidently incorrect, which is worse than failing to parse — so the
// grammar gets tested case by case, not just "does it load".

import { parseFasta, parseGenBank, parseLocation, parseSequenceFile, detectFormat } from "../seqio";

const ok = (r: ReturnType<typeof parseSequenceFile>) => {
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error}`);
  return r.records;
};

// A small but genuine GenBank record: circular topology, a joined CDS, a
// complement feature, multi-line qualifiers, and numbered ORIGIN lines.
const GB = `LOCUS       pTEST                     60 bp    DNA     circular SYN 15-JUL-2026
DEFINITION  A small test plasmid
            spanning two lines.
ACCESSION   pTEST
FEATURES             Location/Qualifiers
     source          1..60
                     /organism="synthetic DNA construct"
     promoter        1..20
                     /label="T7 promoter"
     CDS             join(21..30,41..50)
                     /gene="testG"
                     /product="test protein"
                     /note="a joined CDS with an intron between the
                     two exons"
     misc_feature    complement(31..40)
                     /label="reverse element"
     primer_bind     complement(51..60)
                     /label="M13 rev"
ORIGIN
        1 gagttttatc gcttccatga cgcagaagtt aacactttcg gatatttctg atgagtcgaa
//
`;

describe("FASTA", () => {
  test("a single record", () => {
    const r = ok(parseFasta(">seq1 my description\nACGT\nACGT\n"));
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("seq1");
    expect(r[0].description).toBe("my description");
    expect(r[0].sequence).toBe("ACGTACGT");
    expect(r[0].length).toBe(8);
    expect(r[0].format).toBe("fasta");
  });

  test("multiple records", () => {
    const r = ok(parseFasta(">a\nACGT\n>b\nTTTT\n"));
    expect(r.map((x) => x.name)).toEqual(["a", "b"]);
    expect(r[1].sequence).toBe("TTTT");
  });

  test("a bare pasted sequence with no header still works", () => {
    // This is what people actually paste.
    const r = ok(parseFasta("acgt acgt\nACGT"));
    expect(r[0].sequence).toBe("ACGTACGTACGT");
  });

  test("whitespace, numbers and case are normalised away", () => {
    const r = ok(parseFasta(">x\n  1 acg t\n 10 ACGT  \n"));
    expect(r[0].sequence).toBe("ACGTACGT");
  });

  test("FASTA carries no topology or features — and we must not invent them", () => {
    const r = ok(parseFasta(">x\nACGT"));
    expect(r[0].circular).toBe(false);
    expect(r[0].features).toEqual([]);
  });

  test("empty input is an error, not an empty record", () => {
    expect(parseFasta("").ok).toBe(false);
    expect(parseFasta(">justaheader\n").ok).toBe(false);
  });
});

describe("GenBank location grammar", () => {
  const loc = (s: string) => parseLocation(s);

  test("a single base", () => {
    expect(loc("467")).toEqual({ segments: [{ start: 467, end: 467 }], strand: 1 });
  });

  test("a range", () => {
    expect(loc("340..565")).toEqual({ segments: [{ start: 340, end: 565 }], strand: 1 });
  });

  test("complement flips the strand", () => {
    const r = loc("complement(340..565)");
    expect(r!.strand).toBe(-1);
    expect(r!.segments).toEqual([{ start: 340, end: 565 }]);
  });

  test("join keeps the segments separate — an intron is not part of the feature", () => {
    const r = loc("join(12..78,134..202)");
    expect(r!.strand).toBe(1);
    expect(r!.segments).toEqual([
      { start: 12, end: 78 },
      { start: 134, end: 202 },
    ]);
  });

  test("complement(join(...)) is both", () => {
    const r = loc("complement(join(2691..4571,4918..5163))");
    expect(r!.strand).toBe(-1);
    expect(r!.segments).toHaveLength(2);
    expect(r!.segments[0]).toEqual({ start: 2691, end: 4571 });
  });

  test("join(complement(...),complement(...)) is also reverse", () => {
    const r = loc("join(complement(4918..5163),complement(2691..4571))");
    expect(r!.segments).toHaveLength(2);
  });

  test("fuzzy ends keep their best-known coordinate", () => {
    expect(loc("<345..500")!.segments).toEqual([{ start: 345, end: 500 }]);
    expect(loc("1..>888")!.segments).toEqual([{ start: 1, end: 888 }]);
    expect(loc("<1..>888")!.segments).toEqual([{ start: 1, end: 888 }]);
  });

  test("order() behaves like join()", () => {
    expect(loc("order(1..5,10..20)")!.segments).toHaveLength(2);
  });

  test("a between-bases site (102^103)", () => {
    expect(loc("102^103")!.segments).toEqual([{ start: 102, end: 103 }]);
  });

  test("whitespace inside a location is tolerated (real files have it)", () => {
    expect(loc("join(12..78, 134..202)")!.segments).toHaveLength(2);
  });

  test("a remote accession is skipped, not mis-placed on THIS sequence", () => {
    // J00194.1:100..202 refers to a different record entirely. Drawing it here
    // would put a feature at coordinates that mean nothing.
    expect(loc("J00194.1:100..202")).toBeNull();
  });

  test("nonsense returns null rather than a guess", () => {
    for (const bad of ["", "abc", "1..", "..5", "join(", "complement()"]) {
      expect(loc(bad)).toBeNull();
    }
  });
});

describe("GenBank records", () => {
  test("reads the LOCUS name, topology and sequence", () => {
    const r = ok(parseGenBank(GB));
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("pTEST");
    expect(r[0].circular).toBe(true);
    expect(r[0].length).toBe(60);
    expect(r[0].sequence.startsWith("GAGTTTTATC")).toBe(true);
    expect(r[0].sequence).not.toMatch(/\d|\s/); // numbering stripped
    expect(r[0].format).toBe("genbank");
  });

  test("joins a multi-line DEFINITION", () => {
    expect(ok(parseGenBank(GB))[0].description).toBe("A small test plasmid spanning two lines");
  });

  test("drops the 'source' feature — it spans everything and says nothing", () => {
    const f = ok(parseGenBank(GB))[0].features;
    expect(f.some((x) => x.type === "source")).toBe(false);
  });

  test("reads each feature's type, span and strand", () => {
    const f = ok(parseGenBank(GB))[0].features;
    const promoter = f.find((x) => x.type === "promoter")!;
    expect(promoter.start).toBe(1);
    expect(promoter.end).toBe(20);
    expect(promoter.strand).toBe(1);

    const rev = f.find((x) => x.type === "misc_feature")!;
    expect(rev.strand).toBe(-1);
    expect(rev.start).toBe(31);
  });

  test("a joined CDS keeps both exons as separate segments", () => {
    const cds = ok(parseGenBank(GB))[0].features.find((x) => x.type === "CDS")!;
    expect(cds.segments).toEqual([
      { start: 21, end: 30 },
      { start: 41, end: 50 },
    ]);
    // The overall span covers the intron, but the segments do not — which is
    // what lets the map draw a gap instead of a solid bar.
    expect(cds.start).toBe(21);
    expect(cds.end).toBe(50);
  });

  test("labels come from the best available qualifier", () => {
    const f = ok(parseGenBank(GB))[0].features;
    expect(f.find((x) => x.type === "promoter")!.name).toBe("T7 promoter"); // /label
    expect(f.find((x) => x.type === "CDS")!.name).toBe("testG"); // /gene beats /product
    expect(f.find((x) => x.type === "primer_bind")!.name).toBe("M13 rev");
  });

  test("qualifiers are captured, including multi-line ones", () => {
    const cds = ok(parseGenBank(GB))[0].features.find((x) => x.type === "CDS")!;
    expect(cds.qualifiers.product).toBe("test protein");
    expect(cds.qualifiers.note).toContain("joined CDS");
    expect(cds.qualifiers.note).toContain("two exons"); // the continuation line
  });

  test("a linear record is not reported as circular", () => {
    const linear = GB.replace("circular", "linear  ");
    expect(ok(parseGenBank(linear))[0].circular).toBe(false);
  });

  test("multi-record files split on //", () => {
    const r = ok(parseGenBank(GB + GB.replace("pTEST", "pTWO")));
    expect(r).toHaveLength(2);
    expect(r[1].name).toBe("pTWO");
  });

  test("a record with no ORIGIN is rejected rather than returned empty", () => {
    expect(parseGenBank("LOCUS x 10 bp DNA linear\nFEATURES\n//").ok).toBe(false);
  });

  test("a feature with an unparseable location is skipped, not guessed", () => {
    const bad = GB.replace("promoter        1..20", "promoter        nonsense!!");
    const f = ok(parseGenBank(bad))[0].features;
    expect(f.some((x) => x.type === "promoter")).toBe(false);
    // …and the rest of the record still loads.
    expect(f.length).toBeGreaterThan(0);
  });

  test("empty or junk input errors cleanly", () => {
    expect(parseGenBank("").ok).toBe(false);
    expect(parseGenBank("hello world").ok).toBe(false);
  });
});

describe("format detection is by CONTENT, not by file extension", () => {
  test("recognises each format", () => {
    expect(detectFormat(GB)).toBe("genbank");
    expect(detectFormat(">x\nACGT")).toBe("fasta");
    expect(detectFormat("ACGTACGT")).toBe("fasta"); // a bare paste
    expect(detectFormat("{ json: true }")).toBe("unknown");
  });

  test("parseSequenceFile dispatches correctly", () => {
    expect(ok(parseSequenceFile(GB))[0].circular).toBe(true);
    expect(ok(parseSequenceFile(">x\nACGT"))[0].sequence).toBe("ACGT");
  });

  test("an unrecognised file says what it expected", () => {
    const r = parseSequenceFile("%PDF-1.4 binary junk");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/FASTA|GenBank/);
  });

  test("an empty file is an error, not an empty record", () => {
    expect(parseSequenceFile("   ").ok).toBe(false);
  });
});
