// Generates a WIPO Standard ST.26 sequence listing (XML) from entered nucleotide
// or amino-acid sequences. ST.26 is the mandatory format for sequence listings in
// patent applications; this produces a well-formed draft covering the common case
// (per-sequence source feature with mol_type + organism qualifiers).
//
// IMPORTANT: this is a drafting aid. The output should be validated in the WIPO
// Sequence tool before filing. Pure string logic — no Office.js, no Date — so it
// is fully unit-testable; the caller supplies the production date.

import { resolveCodon } from "./dna";

export type MolType = "DNA" | "RNA" | "AA";

export interface St26Qualifier {
  name: string;
  value: string;
}

/** An ST.26 feature to annotate on a sequence (beyond the mandatory `source`). */
export interface St26Feature {
  /** INSDC feature key: "CDS", "gene", "mRNA", "misc_feature", … */
  key: string;
  /** ST.26 location, e.g. "1..300" (1-based, inclusive). */
  location: string;
  qualifiers: St26Qualifier[];
}

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
  /** Optional annotated features (CDS, gene, …) beyond the source feature. */
  features?: St26Feature[];
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

/** One `<INSDQualifier>` element (id unique within its feature). */
function qual(id: number, name: string, value: string): string {
  return (
    `<INSDQualifier id="q${id}">` +
    el("INSDQualifier_name", name) +
    el("INSDQualifier_value", value) +
    "</INSDQualifier>"
  );
}

function sourceFeatureInner(moltype: MolType, length: number, organism: string, sourceMolType?: string): string {
  const org = organism.trim() || "synthetic construct";
  // Use the caller's mol_type only if it's valid for this molecule; else default.
  const molType =
    sourceMolType && MOL_TYPE_OPTIONS[moltype].indexOf(sourceMolType) >= 0 ? sourceMolType : MOL_TYPE_QUAL[moltype];
  return (
    "<INSDFeature>" +
    el("INSDFeature_key", "source") +
    el("INSDFeature_location", `1..${length}`) +
    "<INSDFeature_quals>" +
    qual(1, "mol_type", molType) +
    qual(2, "organism", org) +
    "</INSDFeature_quals></INSDFeature>"
  );
}

/** Translates a coding nucleotide string to protein, stopping at the first stop codon. */
export function translateCds(nucleotides: string): string {
  const s = nucleotides.toUpperCase().replace(/U/g, "T");
  let protein = "";
  for (let i = 0; i + 3 <= s.length; i += 3) {
    const aa = resolveCodon(s.substring(i, i + 3));
    if (aa === "*") break;
    protein += aa;
  }
  return protein;
}

/** The residues a simple "start..end" (1-based) CDS location covers, or null. */
function cdsRegion(location: string, residues: string): string | null {
  const loc = location.trim();
  if (!loc) return residues;
  const m = /^(\d+)\.\.(\d+)$/.exec(loc);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    if (start >= 1 && end <= residues.length && start <= end) return residues.slice(start - 1, end);
  }
  return null; // out of range / single position / join()/complement() — user supplies /translation
}

function featureInner(feature: St26Feature, moltype: MolType, residues: string): string {
  const key = feature.key.trim() || "misc_feature";
  const location = feature.location.trim() || `1..${residues.length}`;
  const quals = feature.qualifiers.filter((q) => q.name.trim() && q.value.trim()).map((q) => ({ name: q.name.trim(), value: q.value.trim() }));
  // Auto-generate /translation (and /codon_start) for a CDS on a nucleotide
  // sequence when the drafter hasn't supplied one and the location is simple.
  if (key.toUpperCase() === "CDS" && moltype !== "AA") {
    const has = (n: string): boolean => quals.some((q) => q.name.toLowerCase() === n);
    const region = cdsRegion(location, residues);
    if (region !== null && !has("translation")) {
      const protein = translateCds(region);
      if (protein) {
        if (!has("codon_start")) quals.push({ name: "codon_start", value: "1" });
        quals.push({ name: "translation", value: protein });
      }
    }
  }
  const qualsXml = quals.length
    ? "<INSDFeature_quals>" + quals.map((q, i) => qual(i + 1, q.name, q.value)).join("") + "</INSDFeature_quals>"
    : "";
  return "<INSDFeature>" + el("INSDFeature_key", key) + el("INSDFeature_location", location) + qualsXml + "</INSDFeature>";
}

/** Advisory warnings for a sequence's features (frame/location sanity). */
export function featureWarnings(entry: SequenceEntry): string[] {
  const warnings: string[] = [];
  const { residues } = cleanResidues(entry.moltype, entry.residues);
  for (const f of entry.features ?? []) {
    if (f.key.trim().toUpperCase() !== "CDS" || entry.moltype === "AA") continue;
    const region = cdsRegion(f.location, residues);
    if (region === null) {
      warnings.push(`CDS location "${f.location}" isn't a simple start..end range — add /translation manually and verify in WIPO Sequence.`);
    } else if (region.length % 3 !== 0) {
      warnings.push(`CDS (${f.location || "whole"}) length ${region.length} is not a multiple of 3 — check the reading frame.`);
    }
  }
  return warnings;
}

function sequenceData(entry: SequenceEntry, idNumber: number): string {
  const { residues, length } = cleanResidues(entry.moltype, entry.residues);
  const features = (entry.features ?? []).map((f) => featureInner(f, entry.moltype, residues)).join("");
  return (
    `<SequenceData sequenceIDNumber="${idNumber}"><INSDSeq>` +
    el("INSDSeq_length", String(length)) +
    el("INSDSeq_moltype", entry.moltype) +
    el("INSDSeq_division", "PAT") +
    "<INSDSeq_feature-table>" +
    sourceFeatureInner(entry.moltype, length, entry.organism ?? "", entry.sourceMolType) +
    features +
    "</INSDSeq_feature-table>" +
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
