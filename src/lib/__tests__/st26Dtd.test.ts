// Every ST.26 sequence listing JurisLab writes validates against WIPO's DTD (hit-list #14). The DTD is Annex II of
// WIPO Standard ST.26, V1_3, vendored from https://www.wipo.int/standards/dtd/ST26SequenceListing_V1_3.dtd (content
// identical, line endings normalised to LF by git; fetched 2026-10-21, as fetched 2026-10-19). DTD validity is necessary, not sufficient: WIPO
// Sequence also applies the standard's business rules, which this does not see (st26Compliance.test.ts covers some).
//
// The validator (__tests__/dtdValidate.ts, a test helper: nothing ships it) was cross-checked against libxml2 (lxml) on this whole corpus and every mutant:
// identical verdicts. To repeat: ST26_DUMP=<dir> npx jest st26Dtd writes each file as <name>.xml with its verdict.
import * as fs from "fs";
import * as path from "path";
import { buildSt26Xml, MOL_TYPE_OPTIONS, st26MetaProblems, type SequenceEntry, type SequenceListingMeta, type MolType } from "../sequence";
import { readDtd, validateAgainstDtd } from "./dtdValidate";

const DTD_TEXT = fs.readFileSync(path.join(__dirname, "fixtures", "ST26SequenceListing_V1_3.dtd"), "utf8");
const DTD = readDtd(DTD_TEXT);

const BASE: SequenceListingMeta = { applicantName: "Acme Bio", inventionTitle: "Widgets", applicantFileReference: "AB-1", productionDate: "2026-10-21" };
const FULL: SequenceListingMeta = {
  applicantName: "Société Générale de Biologie — 株式会社",
  inventionTitle: "Méthodes & <compositions> for “quoted” titles",
  applicantFileReference: "1610-004PCT1",
  ipOfficeCode: "US",
  applicationNumber: "17/227,176",
  filingDate: "2021-04-09",
  productionDate: "2026-10-21",
  softwareName: "JurisLab",
  softwareVersion: "2.182.0",
  fileName: "listing.xml",
};
const CDS = "atgggtgcttgtatgcatatgggtgcttgtatgcatatgggtgcttgtatgcatatgggttaa";

/** The corpus: every moltype and source mol_type, features with qualifiers, several entries, every meta field. */
function corpus(): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (name: string, meta: SequenceListingMeta, entries: SequenceEntry[]): void => {
    out[name] = buildSt26Xml(meta, entries);
  };
  const residues: Record<MolType, string> = { DNA: "atgcatgcatgcatgcatgc", RNA: "augcaugcaugcaugcaugc", AA: "MKTAYIAKQRQISFVKSHFSRQ" };
  for (const mt of ["DNA", "RNA", "AA"] as MolType[]) {
    add(`${mt}-bare`, BASE, [{ moltype: mt, residues: residues[mt] }]);
    add(`${mt}-full-meta`, FULL, [{ moltype: mt, residues: residues[mt], organism: "Homo sapiens" }]);
    for (const smt of MOL_TYPE_OPTIONS[mt]) add(`${mt}-${smt.replace(/\W+/g, "_")}`, BASE, [{ moltype: mt, residues: residues[mt], sourceMolType: smt }]);
  }
  add("cds-translation", BASE, [{ moltype: "DNA", residues: CDS, features: [{ key: "CDS", location: "1..63", qualifiers: [{ name: "gene", value: "abc" }] }] }]);
  add("cds-codon-start", BASE, [{ moltype: "DNA", residues: "a" + CDS.slice(0, 60), features: [{ key: "CDS", location: "1..61", qualifiers: [{ name: "codon_start", value: "2" }] }] }]);
  add("misc-feature-note", BASE, [{ moltype: "DNA", residues: "nnnnatgcatgcatgcnnnn", features: [{ key: "misc_feature", location: "1..4", qualifiers: [{ name: "note", value: "n is a, c, g or t" }] }] }]);
  add("protein-features", BASE, [{ moltype: "AA", residues: "MKTAYIAKQRQISFVKSHFSRQ", features: [{ key: "REGION", location: "1..10", qualifiers: [{ name: "note", value: "signal" }] }] }]);
  add("several", FULL, [
    { moltype: "DNA", residues: CDS, features: [{ key: "CDS", location: "1..63", qualifiers: [] }] },
    { moltype: "AA", residues: "MGACMHMGACMHMGACMHMG" },
    { moltype: "RNA", residues: "augcaugcaugcaugcaugc", sourceMolType: MOL_TYPE_OPTIONS.RNA[0] },
    { moltype: "DNA", residues: "acgt" },
  ]);
  add("reference-only", { ...BASE, applicantFileReference: "REF-1" }, [{ moltype: "DNA", residues: "acgtacgtacgt" }]);
  add("application-only", { ...BASE, ipOfficeCode: "EP", applicationNumber: "21123456.7" }, [{ moltype: "DNA", residues: "acgtacgtacgt" }]);
  return out;
}

/** Mutants: one per class of validity error — each must be refused, or the validator is too lenient to trust. */
function mutants(valid: string): Record<string, string> {
  const once = (re: RegExp, to: string): string => {
    if (!re.test(valid)) throw new Error(`mutant pattern not found: ${re}`);
    return valid.replace(re, to);
  };
  return {
    "missing-required-child": once(/<SequenceTotalQuantity>[^<]*<\/SequenceTotalQuantity>/, ""),
    "children-out-of-order": once(/(<INSDSeq_length>[^<]*<\/INSDSeq_length>)(<INSDSeq_moltype>[^<]*<\/INSDSeq_moltype>)/, "$2$1"),
    "extra-child": once(/(<INSDSeq_division>[^<]*<\/INSDSeq_division>)/, "$1$1"),
    "unknown-element": once(/(<INSDSeq_length>)/, "<Remark>x</Remark>$1"),
    "missing-required-attribute": once(/<SequenceData sequenceIDNumber="1">/, "<SequenceData>"),
    "undeclared-attribute": once(/<SequenceData sequenceIDNumber="1">/, '<SequenceData sequenceIDNumber="1" colour="blue">'),
    "text-in-element-only": once(/(<INSDSeq>)/, "$1stray text"),
    "element-in-pcdata": once(/<INSDSeq_division>([^<]*)<\/INSDSeq_division>/, "<INSDSeq_division><Bold>$1</Bold></INSDSeq_division>"),
    "duplicate-id": once(/(<INSDQualifier id=")q\d+(">[\s\S]*?<INSDQualifier id=")q\d+(")/, "$1qdup$2qdup$3"),
    "root-not-doctype": once(/<!DOCTYPE ST26SequenceListing /, "<!DOCTYPE SequenceListing "),
    // Review round 1: non-XML whitespace in element-only content, and an xmlns attribute the DTD does not declare.
    "nbsp-in-element-only": once(/(<INSDSeq>)/, "$1" + String.fromCharCode(0xa0)),
    "em-space-in-element-only": once(/(<INSDSeq>)/, "$1" + String.fromCharCode(0x2003)),
    "xmlns-attribute": once(/<ST26SequenceListing /, '<ST26SequenceListing xmlns="urn:x" '),
    "doctype-only-in-a-comment": once(/<!DOCTYPE ST26SequenceListing ([^>]*)>/, "<!-- <!DOCTYPE ST26SequenceListing $1> --><!DOCTYPE SequenceListing $1>"),
  };
}

describe("the DTD reader takes exactly WIPO's constructs and refuses the rest", () => {
  test("WIPO's DTD reads: 30 elements, 6 attribute lists", () => {
    expect(DTD.elements.size).toBe(30);
    expect(DTD.attrs.size).toBe(6);
  });
  test.each([
    ["a parameter entity", '<!ENTITY % x "a">'],
    ["mixed content", "<!ELEMENT a (#PCDATA | b)*>"],
    ["ANY", "<!ELEMENT a ANY>"],
    ["EMPTY", "<!ELEMENT a EMPTY>"],
    ["an enumeration", "<!ATTLIST a k (x|y) #REQUIRED>"],
    ["#FIXED", '<!ATTLIST a k CDATA #FIXED "1">'],
  ])("%s is refused, never ignored", (_why, text) => {
    expect(() => readDtd(text)).toThrow(/DTD/);
  });
});

describe("every listing JurisLab writes is valid against WIPO's ST.26 DTD", () => {
  const files = corpus();
  const dump = process.env.ST26_DUMP;
  test.each(Object.keys(files))("%s", (name) => {
    const errors = validateAgainstDtd(files[name], DTD);
    if (dump) fs.writeFileSync(path.join(dump, `valid--${name}.xml`), files[name]);
    expect(errors).toEqual([]);
  });
});

describe("the validator refuses each class of error (mutation canaries)", () => {
  const valid = buildSt26Xml(BASE, [{ moltype: "DNA", residues: CDS, features: [{ key: "CDS", location: "1..63", qualifiers: [{ name: "gene", value: "abc" }] }] }]);
  const ms = mutants(valid);
  test.each(Object.keys(ms))("%s", (name) => {
    if (process.env.ST26_DUMP) fs.writeFileSync(path.join(process.env.ST26_DUMP, `invalid--${name}.xml`), ms[name]);
    expect(validateAgainstDtd(ms[name], DTD).length).toBeGreaterThan(0);
  });
  test("the unmutated listing is valid (the canaries fail for their mutation, not for the base)", () => {
    expect(validateAgainstDtd(valid, DTD)).toEqual([]);
  });
});

describe("the two defects the DTD gate found in v2.181.0 (libxml2 agreed on both)", () => {
  test("qualifier ids are unique across the WHOLE listing (they restarted at q1 in every feature: 'ID q1 already defined')", () => {
    const xml = buildSt26Xml(BASE, [
      { moltype: "DNA", residues: CDS, features: [{ key: "CDS", location: "1..63", qualifiers: [{ name: "gene", value: "abc" }] }] },
      { moltype: "AA", residues: "MKTAYIAKQRQI" },
    ]);
    const ids = [...xml.matchAll(/<INSDQualifier id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("q1");
    // and a second build starts again at q1 (the counter is per listing)
    expect(/<INSDQualifier id="([^"]+)"/.exec(buildSt26Xml(BASE, [{ moltype: "DNA", residues: "acgtacgtacgt" }]))![1]).toBe("q1");
  });

  test("the header the DTD requires is named before a listing is built (it was exported without it)", () => {
    expect(st26MetaProblems({ applicantName: "A", inventionTitle: "T", productionDate: "2026-10-21" })).toEqual([
      "ST.26 needs the applicant's file reference, or the application's office code and number.",
    ]);
    expect(st26MetaProblems({ applicantName: "A", inventionTitle: "T", productionDate: "2026-10-21", applicationNumber: "17/227,176" })).toEqual([
      "The application identification needs both the office code (e.g. US) and the application number.",
    ]);
    expect(st26MetaProblems({ ...BASE })).toEqual([]);
    expect(st26MetaProblems({ applicantName: "A", inventionTitle: "T", productionDate: "2026-10-21", ipOfficeCode: "US", applicationNumber: "17/227,176" })).toEqual([]);
  });

  test("the pane refuses to build until the header is complete", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    const at = pane.indexOf("const metaProblems = st26MetaProblems(meta);");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(pane.indexOf("seqXml = buildSt26Xml(meta, entries);"));
    expect(pane.slice(at, at + 300)).toMatch(/return;/);
  });
});

describe("stage-14 review: the DTD reader is strict where libxml2 is", () => {
  test.each([
    ["two names with no , or | between them", "<!ELEMENT r (a b)>"],
    ["an element declared twice", "<!ELEMENT a (#PCDATA)><!ELEMENT a (#PCDATA)>"],
    ["two ID attributes on one element", "<!ATTLIST a i ID #IMPLIED j ID #IMPLIED>"],
  ])("%s is refused", (_why, text) => expect(() => readDtd(text)).toThrow(/DTD/));
  test("the FIRST declaration of an attribute is binding (XML 1.0 §3.3)", () => {
    const d = readDtd("<!ELEMENT r (#PCDATA)><!ATTLIST r k CDATA #REQUIRED><!ATTLIST r k CDATA #IMPLIED>");
    expect(validateAgainstDtd('<!DOCTYPE r SYSTEM "r.dtd"><r>x</r>', d)).toEqual(["line 1: r lacks its required attribute k"]);
  });
  test("a required attribute named like an Object property is still required", () => {
    const d = readDtd("<!ELEMENT r (#PCDATA)><!ATTLIST r constructor CDATA #REQUIRED>");
    expect(validateAgainstDtd('<!DOCTYPE r SYSTEM "r.dtd"><r>x</r>', d).length).toBe(1);
  });
  test("an ID is normalised before it is checked, and may hold non-ASCII letters", () => {
    const d = readDtd("<!ELEMENT r (#PCDATA)><!ATTLIST r i ID #IMPLIED>");
    expect(validateAgainstDtd('<!DOCTYPE r SYSTEM "r.dtd"><r i=" q1 ">x</r>', d)).toEqual([]);
    expect(validateAgainstDtd('<!DOCTYPE r SYSTEM "r.dtd"><r i="ét1">x</r>', d)).toEqual([]);
  });
});

describe("stage-14 review: a refused build leaves nothing to download", () => {
  test("generateSequenceXml clears the previous listing before any refusal", () => {
    const pane = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
    const at = pane.indexOf("function generateSequenceXml(): void {");
    const firstReturn = pane.indexOf("return;", at);
    const head = pane.slice(at, firstReturn);
    for (const reset of ['seqXml = "";', 'seqOutput.value = "";', "seqDownloadBtn.disabled = true;", "seqCopyBtn.disabled = true;"]) expect(head).toContain(reset);
  });
  test("whitespace-only header fields count as empty in the builder, as in st26MetaProblems", () => {
    const xml = buildSt26Xml({ ...BASE, ipOfficeCode: "  " }, [{ moltype: "DNA", residues: "acgtacgtacgt" }]);
    expect(xml).not.toContain("<ApplicationIdentification>");
    expect(validateAgainstDtd(xml, DTD)).toEqual([]);
  });
});
