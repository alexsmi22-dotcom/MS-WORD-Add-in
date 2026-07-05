// Generates a WIPO Standard ST.26 sequence listing (XML) from entered nucleotide
// or amino-acid sequences. ST.26 is the mandatory format for sequence listings in
// patent applications; this produces a well-formed draft covering the common case
// (per-sequence source feature with mol_type + organism qualifiers).
//
// IMPORTANT: this is a drafting aid. The output should be validated in the WIPO
// Sequence tool before filing. Pure string logic — no Office.js, no Date — so it
// is fully unit-testable; the caller supplies the production date.

export type MolType = "DNA" | "RNA" | "AA";

export interface SequenceEntry {
  moltype: MolType;
  /** Raw residues as typed (may contain whitespace, numbers, line breaks). */
  residues: string;
  /** Source organism; defaults to "synthetic construct" when blank. */
  organism?: string;
  /**
   * The ST.26 source `mol_type` qualifier value (e.g. "mRNA", "tRNA"). Must be
   * one of MOL_TYPE_OPTIONS for the moltype; falls back to the default when
   * absent or invalid.
   */
  sourceMolType?: string;
}

/** ST.26 controlled vocabulary for the source-feature `mol_type` qualifier. */
export const MOL_TYPE_OPTIONS: Record<MolType, string[]> = {
  DNA: ["genomic DNA", "other DNA", "unassigned DNA"],
  RNA: ["genomic RNA", "mRNA", "tRNA", "rRNA", "other RNA", "transcribed RNA", "viral cRNA", "unassigned RNA"],
  AA: ["protein"],
};

export interface SequenceListingMeta {
  applicantName: string;
  inventionTitle: string;
  applicantFileReference?: string;
  ipOfficeCode?: string;
  applicationNumber?: string;
  filingDate?: string;
  /** YYYY-MM-DD — supplied by the caller (keeps this module Date-free/testable). */
  productionDate: string;
  softwareName?: string;
  softwareVersion?: string;
  fileName?: string;
}

// Allowed residue alphabets (lowercase for nucleotides, uppercase for amino acids).
const DNA = "acgtryswkmbdhvn";
const RNA = "acguryswkmbdhvn";
const AA = "ABCDEFGHIJKLMNPQRSTVWYZXUO"; // 20 + ambiguity (B,Z,J,X) + U(Sec) + O(Pyl)

const ALPHABET: Record<MolType, string> = { DNA, RNA, AA };

export interface CleanedResidues {
  /** Valid residues only, normalized case. */
  residues: string;
  length: number;
  /** Distinct invalid characters that were dropped (for a UI warning). */
  invalid: string[];
}

/** Strips whitespace/digits, normalizes case, and validates against the alphabet. */
export function cleanResidues(moltype: MolType, raw: string): CleanedResidues {
  const letters = raw.replace(/[^A-Za-z]/g, "");
  const normalized = moltype === "AA" ? letters.toUpperCase() : letters.toLowerCase();
  const allowed = ALPHABET[moltype];
  let residues = "";
  const invalid: Record<string, true> = {};
  for (const ch of normalized) {
    if (allowed.indexOf(ch) >= 0) residues += ch;
    else invalid[ch] = true;
  }
  return { residues, length: residues.length, invalid: Object.keys(invalid) };
}

const MOL_TYPE_QUAL: Record<MolType, string> = {
  DNA: "genomic DNA",
  RNA: "genomic RNA",
  AA: "protein",
};

function escapeXml(s: string): string {
  return s
    // Drop characters not permitted in XML 1.0 so free-text fields can't make the
    // document ill-formed (residues are already cleaned to letters).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function el(tag: string, value: string): string {
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function sourceFeature(moltype: MolType, length: number, organism: string, sourceMolType?: string): string {
  const org = organism.trim() || "synthetic construct";
  // Use the caller's mol_type only if it's valid for this molecule; else default.
  const molType =
    sourceMolType && MOL_TYPE_OPTIONS[moltype].indexOf(sourceMolType) >= 0 ? sourceMolType : MOL_TYPE_QUAL[moltype];
  return (
    "<INSDSeq_feature-table><INSDFeature>" +
    "<INSDFeature_key>source</INSDFeature_key>" +
    el("INSDFeature_location", `1..${length}`) +
    "<INSDFeature_quals>" +
    `<INSDQualifier id="q1"><INSDQualifier_name>mol_type</INSDQualifier_name>` +
    el("INSDQualifier_value", molType) +
    "</INSDQualifier>" +
    `<INSDQualifier id="q2"><INSDQualifier_name>organism</INSDQualifier_name>` +
    el("INSDQualifier_value", org) +
    "</INSDQualifier>" +
    "</INSDFeature_quals></INSDFeature></INSDSeq_feature-table>"
  );
}

function sequenceData(entry: SequenceEntry, idNumber: number): string {
  const { residues, length } = cleanResidues(entry.moltype, entry.residues);
  return (
    `<SequenceData sequenceIDNumber="${idNumber}"><INSDSeq>` +
    el("INSDSeq_length", String(length)) +
    el("INSDSeq_moltype", entry.moltype) +
    el("INSDSeq_division", "PAT") +
    sourceFeature(entry.moltype, length, entry.organism ?? "", entry.sourceMolType) +
    el("INSDSeq_sequence", residues) +
    "</INSDSeq></SequenceData>"
  );
}

const DTD_VERSION = "V1_3";

/** Builds a complete ST.26 sequence-listing XML document. */
export function buildSt26Xml(meta: SequenceListingMeta, entries: SequenceEntry[]): string {
  const rootAttrs =
    `originalFreeTextLanguageCode="en" dtdVersion="${DTD_VERSION}"` +
    ` fileName="${escapeXml(meta.fileName || "sequence-listing.xml")}"` +
    ` softwareName="${escapeXml(meta.softwareName || "JurisLab")}"` +
    ` softwareVersion="${escapeXml(meta.softwareVersion || "1.0.0")}"` +
    ` productionDate="${escapeXml(meta.productionDate)}"`;

  const appId =
    meta.ipOfficeCode || meta.applicationNumber || meta.filingDate
      ? "<ApplicationIdentification>" +
        (meta.ipOfficeCode ? el("IPOfficeCode", meta.ipOfficeCode) : "") +
        (meta.applicationNumber ? el("ApplicationNumberText", meta.applicationNumber) : "") +
        (meta.filingDate ? el("FilingDate", meta.filingDate) : "") +
        "</ApplicationIdentification>"
      : "";

  const fileRef = meta.applicantFileReference
    ? el("ApplicantFileReference", meta.applicantFileReference)
    : "";

  const body =
    appId +
    fileRef +
    `<ApplicantName languageCode="en">${escapeXml(meta.applicantName)}</ApplicantName>` +
    `<InventionTitle languageCode="en">${escapeXml(meta.inventionTitle)}</InventionTitle>` +
    el("SequenceTotalQuantity", String(entries.length)) +
    entries.map((e, i) => sequenceData(e, i + 1)).join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<!DOCTYPE ST26SequenceListing PUBLIC "-//WIPO//DTD Sequence Listing 1.3//EN" "ST26SequenceListing_${DTD_VERSION}.dtd">\n` +
    `<ST26SequenceListing ${rootAttrs}>` +
    body +
    "</ST26SequenceListing>\n"
  );
}
