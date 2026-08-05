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

// --- ST.26 minimum length ---------------------------------------------------
//
// WIPO ST.26 paragraph 8: a sequence with fewer than ten SPECIFICALLY DEFINED
// nucleotides, or fewer than four specifically defined amino acids, is not
// included in the listing at all. "Specifically defined" is the load-bearing
// phrase — an IUPAC ambiguity code (n, r, y…) and an X are not specifically
// defined residues, so a 30-mer of mostly n does not qualify on length.

/** Minimum number of specifically defined residues for a sequence to be listed. */
export const ST26_MIN_DEFINED: Record<MolType, number> = { DNA: 10, RNA: 10, AA: 4 };

const DEFINED_DNA = "acgt";
const DEFINED_RNA = "acgu";
// The 20 standard residues plus Sec (U) and Pyl (O). B, Z, J and X are ambiguity
// codes, not specifically defined amino acids.
const DEFINED_AA = "ACDEFGHIKLMNPQRSTVWYUO";
const DEFINED: Record<MolType, string> = { DNA: DEFINED_DNA, RNA: DEFINED_RNA, AA: DEFINED_AA };

/** Counts residues that are specifically defined (not IUPAC-ambiguous, not X). */
export function definedResidueCount(moltype: MolType, residues: string): number {
  const allowed = DEFINED[moltype];
  let n = 0;
  for (const ch of residues) if (allowed.indexOf(ch) >= 0) n++;
  return n;
}

export interface St26Exclusion {
  /** 0-based position in the `entries` array handed to the builder. */
  index: number;
  moltype: MolType;
  /** Total cleaned residues. */
  length: number;
  /** How many of those are specifically defined. */
  defined: number;
  /** The ST.26 minimum for this molecule type. */
  minimum: number;
  /** Plain-language reason, ready to show. */
  reason: string;
}

/**
 * The entries ST.26 will not let you list, and why.
 *
 * THIS LIST IS THE SAFETY MECHANISM, not a decoration. `buildSt26Xml` drops
 * these entries, which means every SEQUENCE AFTER ONE OF THEM IS RENUMBERED:
 * the third box in the pane stops being SEQ ID NO: 3, and the specification's
 * "SEQ ID NO: 3" then points at a different molecule. That is the same class of
 * silent wrong-statement-of-record as filing the wrong organism, so the caller
 * must surface this list and make the user resolve it — not print it as a soft
 * warning beside a downloadable file.
 */
export function st26Exclusions(entries: SequenceEntry[]): St26Exclusion[] {
  const out: St26Exclusion[] = [];
  entries.forEach((e, index) => {
    const { residues, length } = cleanResidues(e.moltype, e.residues);
    const defined = definedResidueCount(e.moltype, residues);
    const minimum = ST26_MIN_DEFINED[e.moltype];
    if (defined >= minimum) return;
    const unit = e.moltype === "AA" ? "amino acid" : "nucleotide";
    const detail =
      defined === length
        ? `${length} ${unit}${length === 1 ? "" : "s"}`
        : `${length} residues, only ${defined} specifically defined (ambiguity codes do not count)`;
    out.push({
      index,
      moltype: e.moltype,
      length,
      defined,
      minimum,
      reason:
        `SEQ ${index + 1} has ${detail} — ST.26 does not list a sequence with fewer than ` +
        `${minimum} specifically defined ${unit}s, so it is EXCLUDED from the listing and the ` +
        "sequences after it are renumbered. Lengthen it or remove it, and check every SEQ ID NO " +
        "reference in the specification.",
    });
  });
  return out;
}

/** True when this entry is short of the ST.26 minimum and must not be listed. */
function belowSt26Minimum(entry: SequenceEntry): boolean {
  const { residues } = cleanResidues(entry.moltype, entry.residues);
  return definedResidueCount(entry.moltype, residues) < ST26_MIN_DEFINED[entry.moltype];
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

/**
 * Translates a coding nucleotide string to protein, stopping at the first stop
 * codon.
 *
 * `codonStart` is the INSDC /codon_start qualifier: 1, 2 or 3, giving the first
 * base of the first complete codon. It used to be ignored — the emitted feature
 * carried the drafter's /codon_start=2 next to a translation read from base 1,
 * so the listing contradicted its own reading frame. In a filed application that
 * is a wrong protein of record.
 */
export function translateCds(nucleotides: string, codonStart: 1 | 2 | 3 = 1): string {
  const s = nucleotides.toUpperCase().replace(/U/g, "T");
  let protein = "";
  for (let i = codonStart - 1; i + 3 <= s.length; i += 3) {
    const aa = resolveCodon(s.substring(i, i + 3));
    if (aa === "*") break;
    protein += aa;
  }
  return protein;
}

/** Reads a /codon_start qualifier value; anything not 1/2/3 falls back to 1. */
function readCodonStart(value: string | undefined): 1 | 2 | 3 {
  const n = parseInt((value ?? "").trim(), 10);
  return n === 2 || n === 3 ? n : 1;
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
      // Honour a drafter-supplied /codon_start rather than translating from base
      // 1 regardless — the two used to disagree in the emitted XML.
      const supplied = quals.find((q) => q.name.toLowerCase() === "codon_start");
      const codonStart = readCodonStart(supplied?.value);
      const protein = translateCds(region, codonStart);
      if (protein) {
        if (!supplied) quals.push({ name: "codon_start", value: "1" });
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
      continue;
    }
    // /codon_start says which base of the region is the first base of the first
    // codon, so the CODABLE length is region.length − (codon_start − 1). Testing
    // region.length alone contradicted `translateCds`, which does apply it: a
    // correct 1..61 CDS with /codon_start=2 (60 codable bases) emitted a perfect
    // 20-aa translation AND "length 61 is not a multiple of 3", while a genuinely
    // broken 60-nt CDS with /codon_start=2 (59 codable) drew no warning at all.
    const supplied = (f.qualifiers ?? []).find((q) => q.name.trim().toLowerCase() === "codon_start");
    const codonStart = readCodonStart(supplied?.value);
    const codable = region.length - (codonStart - 1);
    const frame = codonStart === 1 ? "" : ` from /codon_start=${codonStart}`;
    if (codable <= 0) {
      warnings.push(
        `CDS (${f.location || "whole"}) has ${region.length} base(s), which is not enough to hold one ` +
          `codon${frame} — check the location and the reading frame.`
      );
    } else if (codable % 3 !== 0) {
      warnings.push(
        `CDS (${f.location || "whole"}) length ${region.length}${frame} leaves ${codable} codable base(s), ` +
          "which is not a multiple of 3 — check the reading frame."
      );
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

  // Sequences below the ST.26 minimum are EXCLUDED — not numbered, not counted.
  // They were previously emitted anyway, numbered and counted in
  // SequenceTotalQuantity, after the pane had already told the user they were too
  // short: the document declared itself compliant while carrying entries the
  // standard forbids. Of the two consistent behaviours, exclusion is the one that
  // produces a filable document; the cost is renumbering, which is exactly what
  // `st26Exclusions` exists to make the caller confront BEFORE it builds.
  const listed = entries.filter((e) => !belowSt26Minimum(e));

  const body =
    appId +
    fileRef +
    `<ApplicantName languageCode="en">${escapeXml(meta.applicantName)}</ApplicantName>` +
    `<InventionTitle languageCode="en">${escapeXml(meta.inventionTitle)}</InventionTitle>` +
    el("SequenceTotalQuantity", String(listed.length)) +
    listed.map((e, i) => sequenceData(e, i + 1)).join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<!DOCTYPE ST26SequenceListing PUBLIC "-//WIPO//DTD Sequence Listing 1.3//EN" "ST26SequenceListing_${DTD_VERSION}.dtd">\n` +
    `<ST26SequenceListing ${rootAttrs}>` +
    body +
    "</ST26SequenceListing>\n"
  );
}
