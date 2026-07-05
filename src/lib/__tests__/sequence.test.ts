import { cleanResidues, buildSt26Xml, SequenceListingMeta, SequenceEntry } from "../sequence";

describe("cleanResidues", () => {
  it("strips whitespace/numbers and lowercases nucleotides", () => {
    const r = cleanResidues("DNA", "  ACG T\n123 acgt ");
    expect(r.residues).toBe("acgtacgt");
    expect(r.length).toBe(8);
    expect(r.invalid).toEqual([]);
  });

  it("uppercases amino acids", () => {
    const r = cleanResidues("AA", "m k l v");
    expect(r.residues).toBe("MKLV");
  });

  it("reports invalid characters (distinct) and drops them", () => {
    const r = cleanResidues("DNA", "acgtxz acgt");
    expect(r.residues).toBe("acgtacgt");
    expect(r.invalid.sort()).toEqual(["x", "z"]);
  });

  it("accepts IUPAC ambiguity codes for nucleotides", () => {
    expect(cleanResidues("DNA", "acgtn").invalid).toEqual([]);
    expect(cleanResidues("RNA", "acgun").invalid).toEqual([]);
  });

  it("accepts amino-acid J (Leu/Ile) and other ambiguity codes", () => {
    expect(cleanResidues("AA", "MKLJBZXUO").invalid).toEqual([]);
  });
});

describe("buildSt26Xml — XML safety", () => {
  it("strips XML-illegal control characters from free-text fields", () => {
    const bell = String.fromCharCode(7); // U+0007, illegal in XML 1.0
    const xml = buildSt26Xml(
      { applicantName: "Acme Corp", inventionTitle: "Wid" + bell + "get", productionDate: "2026-06-17" },
      [{ moltype: "DNA", residues: "acgt" }],
    );
    expect(xml).toContain("Widget");
    expect(xml).not.toContain(bell);
  });
});

describe("buildSt26Xml", () => {
  const meta: SequenceListingMeta = {
    applicantName: "Acme & Co.",
    inventionTitle: "Novel <Construct>",
    applicantFileReference: "ABC-123",
    ipOfficeCode: "US",
    applicationNumber: "63/000000",
    filingDate: "2026-06-17",
    productionDate: "2026-06-17",
  };
  const entries: SequenceEntry[] = [
    { moltype: "DNA", residues: "ACGTACGTACGT", organism: "Homo sapiens" },
    { moltype: "AA", residues: "MKLVNT", organism: "" },
  ];
  const xml = buildSt26Xml(meta, entries);

  it("emits the XML declaration and ST.26 DOCTYPE", () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<!DOCTYPE ST26SequenceListing");
    expect(xml).toContain('dtdVersion="V1_3"');
  });

  it("includes applicant, title, and total quantity", () => {
    expect(xml).toContain("Acme &amp; Co.");
    expect(xml).toContain("Novel &lt;Construct&gt;");
    expect(xml).toContain("<SequenceTotalQuantity>2</SequenceTotalQuantity>");
  });

  it("numbers sequences and records length, moltype, and cleaned residues", () => {
    expect(xml).toContain('<SequenceData sequenceIDNumber="1">');
    expect(xml).toContain('<SequenceData sequenceIDNumber="2">');
    expect(xml).toContain("<INSDSeq_length>12</INSDSeq_length>");
    expect(xml).toContain("<INSDSeq_moltype>DNA</INSDSeq_moltype>");
    expect(xml).toContain("<INSDSeq_moltype>AA</INSDSeq_moltype>");
    expect(xml).toContain("<INSDSeq_sequence>acgtacgtacgt</INSDSeq_sequence>");
    expect(xml).toContain("<INSDSeq_sequence>MKLVNT</INSDSeq_sequence>");
  });

  it("adds a source feature with mol_type and organism qualifiers", () => {
    expect(xml).toContain("<INSDFeature_key>source</INSDFeature_key>");
    expect(xml).toContain("<INSDQualifier_value>genomic DNA</INSDQualifier_value>");
    expect(xml).toContain("<INSDQualifier_value>Homo sapiens</INSDQualifier_value>");
    expect(xml).toContain("<INSDQualifier_value>protein</INSDQualifier_value>");
    // blank organism defaults to synthetic construct
    expect(xml).toContain("<INSDQualifier_value>synthetic construct</INSDQualifier_value>");
  });

  it("uses a chosen ST.26 mol_type (mRNA) and rejects an invalid one", () => {
    const m: SequenceListingMeta = { applicantName: "A", inventionTitle: "B", productionDate: "2026-06-17" };
    const mrna = buildSt26Xml(m, [{ moltype: "RNA", residues: "acgu", sourceMolType: "mRNA" }]);
    expect(mrna).toContain("<INSDQualifier_value>mRNA</INSDQualifier_value>");
    // An invalid value for the molecule falls back to the default.
    const bad = buildSt26Xml(m, [{ moltype: "DNA", residues: "acgt", sourceMolType: "mRNA" }]);
    expect(bad).toContain("<INSDQualifier_value>genomic DNA</INSDQualifier_value>");
    expect(bad).not.toContain(">mRNA<");
  });

  it("omits ApplicationIdentification when no office/number/date given", () => {
    const slim = buildSt26Xml(
      { applicantName: "A", inventionTitle: "B", productionDate: "2026-06-17" },
      [{ moltype: "DNA", residues: "acgt" }],
    );
    expect(slim).not.toContain("<ApplicationIdentification>");
    expect(slim).toContain("<SequenceTotalQuantity>1</SequenceTotalQuantity>");
  });
});
