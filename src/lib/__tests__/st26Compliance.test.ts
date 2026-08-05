// Two ST.26 defects from 0.31, both silent, both statements of record.
//
// F6 — `featureWarnings` ignored /codon_start while `translateCds` applies it, so
// a CORRECT CDS drew a frame warning and a genuinely broken one drew none.
//
// F7 — `buildSt26Xml` emitted sequences the pane had already warned were below
// the ST.26 minimum, numbered them, and counted them in SequenceTotalQuantity:
// the listing declared itself compliant while carrying entries the standard
// forbids.

import {
  featureWarnings,
  buildSt26Xml,
  st26Exclusions,
  definedResidueCount,
  ST26_MIN_DEFINED,
  translateCds,
  SequenceEntry,
} from "../sequence";

const META = { applicantName: "A", inventionTitle: "T", productionDate: "2026-08-05" };
const build = (entries: SequenceEntry[]) => buildSt26Xml(META, entries);

// 61 bases. With /codon_start=2 the codable region is 60 — a valid 20-codon frame.
const CDS61 =
  "a" + "atgggtgcttgtatgcatatgggtgcttgtatgcatatgggtgcttgtatgcatatgggt";

describe("featureWarnings honours /codon_start — defect 0.31", () => {
  const entry = (quals: { name: string; value: string }[]): SequenceEntry => ({
    moltype: "DNA",
    residues: CDS61,
    features: [{ key: "CDS", location: "1..61", qualifiers: quals }],
  });

  test("REPRODUCTION: a correct 1..61 CDS with /codon_start=2 no longer warns", () => {
    expect(CDS61.length).toBe(61);
    // The translation the SAME entry emits is a clean 20-mer, which is the proof
    // that the frame is fine and the warning was wrong.
    expect(translateCds(CDS61.toUpperCase(), 2).length).toBe(20);
    expect(featureWarnings(entry([{ name: "codon_start", value: "2" }]))).toEqual([]);
  });

  test("the XML and the warning now agree with each other", () => {
    const xml = build([entry([{ name: "codon_start", value: "2" }])]);
    expect(xml).toContain("<INSDQualifier_value>MGACMHMGACMHMGACMHMG</INSDQualifier_value>");
    expect(featureWarnings(entry([{ name: "codon_start", value: "2" }]))).toEqual([]);
  });

  test("REPRODUCTION: the converse — a broken frame under /codon_start=2 now warns", () => {
    // 60 bases with codon_start=2 leaves 59 codable, which is NOT a multiple of
    // 3. This drew no warning at all before.
    const sixty: SequenceEntry = {
      moltype: "DNA",
      residues: CDS61.slice(0, 60),
      features: [{ key: "CDS", location: "1..60", qualifiers: [{ name: "codon_start", value: "2" }] }],
    };
    const w = featureWarnings(sixty);
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/59 codable base/);
    expect(w[0]).toMatch(/not a multiple of 3/);
  });

  test("frame 1 behaviour is unchanged", () => {
    expect(featureWarnings(entry([]))).toEqual([expect.stringContaining("not a multiple of 3")]);
    const sixty: SequenceEntry = {
      moltype: "DNA",
      residues: CDS61.slice(0, 60),
      features: [{ key: "CDS", location: "1..60", qualifiers: [] }],
    };
    expect(featureWarnings(sixty)).toEqual([]);
  });

  test("a nonsense /codon_start falls back to frame 1, as translateCds does", () => {
    expect(featureWarnings(entry([{ name: "codon_start", value: "banana" }])))
      .toEqual([expect.stringContaining("not a multiple of 3")]);
  });

  test("a region too short to hold a codon says so", () => {
    const tiny: SequenceEntry = {
      moltype: "DNA",
      residues: CDS61,
      features: [{ key: "CDS", location: "1..2", qualifiers: [{ name: "codon_start", value: "3" }] }],
    };
    expect(featureWarnings(tiny)).toEqual([expect.stringContaining("not enough to hold one codon")]);
  });
});

describe("ST.26 minimum length — defect 0.31", () => {
  const SHORT_DNA: SequenceEntry = { moltype: "DNA", residues: "acgt" }; // 4 nt
  const GOOD_DNA: SequenceEntry = { moltype: "DNA", residues: "acgtacgtacgt", organism: "Homo sapiens" };
  const GOOD_AA: SequenceEntry = { moltype: "AA", residues: "MKLVNT" };

  test("the minimums are the ST.26 ones", () => {
    expect(ST26_MIN_DEFINED).toEqual({ DNA: 10, RNA: 10, AA: 4 });
  });

  test("REPRODUCTION: a sub-minimum sequence is no longer emitted or counted", () => {
    const xml = build([GOOD_DNA, SHORT_DNA, GOOD_AA]);
    expect(xml).toContain("<SequenceTotalQuantity>2</SequenceTotalQuantity>");
    expect((xml.match(/<SequenceData /g) ?? []).length).toBe(2);
    expect(xml).not.toContain("<INSDSeq_sequence>acgt</INSDSeq_sequence>");
  });

  test("numbering closes up rather than leaving a hole", () => {
    const xml = build([GOOD_DNA, SHORT_DNA, GOOD_AA]);
    expect(xml).toContain('sequenceIDNumber="1"');
    expect(xml).toContain('sequenceIDNumber="2"');
    expect(xml).not.toContain('sequenceIDNumber="3"');
    // …and the entry that moved is the AA one, which is exactly why the caller
    // must be told: the specification's "SEQ ID NO: 3" now points at nothing.
    expect(xml.indexOf("MKLVNT")).toBeGreaterThan(xml.indexOf('sequenceIDNumber="2"'));
  });

  test("the exclusion list names the entry, the reason and the renumbering", () => {
    const ex = st26Exclusions([GOOD_DNA, SHORT_DNA, GOOD_AA]);
    expect(ex.length).toBe(1);
    expect(ex[0].index).toBe(1);
    expect(ex[0].defined).toBe(4);
    expect(ex[0].minimum).toBe(10);
    expect(ex[0].reason).toMatch(/SEQ 2/);
    expect(ex[0].reason).toMatch(/EXCLUDED/);
    expect(ex[0].reason).toMatch(/renumbered/);
  });

  test("nothing is excluded when everything is long enough", () => {
    expect(st26Exclusions([GOOD_DNA, GOOD_AA])).toEqual([]);
    expect(build([GOOD_DNA, GOOD_AA])).toContain("<SequenceTotalQuantity>2</SequenceTotalQuantity>");
  });

  test("SPECIFICALLY DEFINED residues are what counts, not raw length", () => {
    // ST.26 paragraph 8: fewer than ten specifically defined nucleotides. An n is
    // not a specifically defined nucleotide, so a 12-mer of mostly n does not
    // qualify on length.
    expect(definedResidueCount("DNA", "acgtnnnnnnnn")).toBe(4);
    const mostlyN: SequenceEntry = { moltype: "DNA", residues: "acgtnnnnnnnn" };
    expect(st26Exclusions([mostlyN]).length).toBe(1);
    expect(st26Exclusions([mostlyN])[0].reason).toMatch(/specifically defined/);
    expect(build([mostlyN])).toContain("<SequenceTotalQuantity>0</SequenceTotalQuantity>");
  });

  test("an amino-acid sequence needs 4, not 10", () => {
    expect(st26Exclusions([{ moltype: "AA", residues: "MKLV" }])).toEqual([]);
    expect(st26Exclusions([{ moltype: "AA", residues: "MKL" }]).length).toBe(1);
    // X is an ambiguity code, not a specifically defined amino acid.
    expect(definedResidueCount("AA", "MKLX")).toBe(3);
  });

  test("Sec and Pyl count as specifically defined amino acids", () => {
    expect(definedResidueCount("AA", "MKUO")).toBe(4);
    expect(st26Exclusions([{ moltype: "AA", residues: "MKUO" }])).toEqual([]);
  });
});
