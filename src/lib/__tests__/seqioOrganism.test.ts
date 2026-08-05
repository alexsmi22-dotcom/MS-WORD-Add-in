// Regression: EVERY GenBank-imported sequence was filed as "synthetic construct".
//
// `SeqRecord` had no organism field and the SOURCE/ORGANISM header lines were
// never parsed, while the pane read the organism out of the `source` FEATURE —
// which `SKIP_FEATURES` has always removed. The lookup therefore returned "" for
// every record ever imported, and `sequence.ts` substituted its default:
//
//     const org = organism.trim() || "synthetic construct";
//
// Import 40 real GenBank records, file an ST.26 listing declaring all 40 as
// synthetic constructs. Silent, legal, and a false statement of record in a
// patent application — WIPO Sequence will not reject it.

import { parseGenBank, parseFasta, parseSequenceFile } from "../seqio";
import { buildSt26Xml } from "../sequence";

const first = (text: string) => {
  const r = parseGenBank(text);
  if (!r.ok) throw new Error(r.error);
  return r.records[0];
};

// A real-shaped human record: SOURCE with a common name, ORGANISM with the
// scientific name, and the indented LINEAGE lines that are NOT part of the name.
const HUMAN = `LOCUS       HSACTB                    60 bp    mRNA    linear   PRI 15-JUL-2026
DEFINITION  Homo sapiens actin beta (ACTB), mRNA.
ACCESSION   NM_001101
SOURCE      Homo sapiens (human)
  ORGANISM  Homo sapiens
            Eukaryota; Metazoa; Chordata; Craniata; Vertebrata; Euteleostomi;
            Mammalia; Eutheria; Euarchontoglires; Primates; Haplorrhini;
            Catarrhini; Hominidae; Homo.
FEATURES             Location/Qualifiers
     source          1..60
                     /organism="Homo sapiens"
                     /mol_type="mRNA"
                     /db_xref="taxon:9606"
     CDS             1..60
                     /gene="ACTB"
ORIGIN
        1 atggatgatg atatcgccgc gctcgtcgtc gacaacggct ccggcatgtg caaggccggc
//
`;

describe("GenBank organism — defect 0.3", () => {
  test("the ORGANISM header line becomes rec.organism", () => {
    expect(first(HUMAN).organism).toBe("Homo sapiens");
  });

  test("the taxonomic lineage is NOT swallowed into the organism name", () => {
    const org = first(HUMAN).organism ?? "";
    expect(org).not.toMatch(/Eukaryota|Metazoa|Chordata|;/);
    expect(org.split(/\s+/).length).toBe(2);
  });

  test("the common name in the SOURCE line is not preferred over ORGANISM", () => {
    // "Homo sapiens (human)" is what SOURCE carries; ORGANISM is the name of record.
    expect(first(HUMAN).organism).not.toMatch(/human/);
  });

  test("the source FEATURE is still kept off the map", () => {
    // Skipping it is deliberate — it spans the whole sequence. Reading its
    // /organism before dropping it is what changed.
    expect(first(HUMAN).features.some((f) => f.type === "source")).toBe(false);
    expect(first(HUMAN).features.map((f) => f.type)).toContain("CDS");
  });

  test("falls back to the source feature's /organism when there is no ORGANISM line", () => {
    // SnapGene and friends export exactly this shape — and this is the shape of
    // the fixture in seqio.test.ts.
    const noHeader = HUMAN.replace(/^SOURCE.*$/m, "").replace(/^ {2}ORGANISM.*$/m, "");
    expect(first(noHeader).organism).toBe("Homo sapiens");
  });

  test("falls back to the SOURCE line when neither of the other two is present", () => {
    const onlySource = HUMAN.replace(/^ {2}ORGANISM.*$/m, "").replace(/\/organism="Homo sapiens"\n/, "");
    expect(first(onlySource).organism).toBe("Homo sapiens (human)");
  });

  test("an unknown organism stays undefined rather than becoming a placeholder", () => {
    const unknown = HUMAN.replace("  ORGANISM  Homo sapiens", "  ORGANISM  Unknown.")
      .replace('/organism="Homo sapiens"', '/organism="unknown"')
      .replace("SOURCE      Homo sapiens (human)", "SOURCE      Unknown.");
    expect(first(unknown).organism).toBeUndefined();
  });

  test("FASTA carries no organism and none is invented", () => {
    const r = parseFasta(">seq1 Homo sapiens actin beta\nACGTACGTACGT\n");
    if (!r.ok) throw new Error(r.error);
    expect(r.records[0].organism).toBeUndefined();
  });

  test("the dispatcher preserves it too", () => {
    const r = parseSequenceFile(HUMAN);
    if (!r.ok) throw new Error(r.error);
    expect(r.records[0].organism).toBe("Homo sapiens");
  });

  test("END TO END: the ST.26 listing no longer says synthetic construct", () => {
    // This is the whole defect in one assertion. Before the fix the pane had
    // nothing to read and this XML said "synthetic construct".
    const rec = first(HUMAN);
    const xml = buildSt26Xml(
      { applicantName: "A", inventionTitle: "T", productionDate: "2026-08-05" },
      [{ moltype: "DNA", residues: rec.sequence, organism: rec.organism ?? "" }],
    );
    expect(xml).toContain("<INSDQualifier_value>Homo sapiens</INSDQualifier_value>");
    expect(xml).not.toContain("synthetic construct");
  });
});
