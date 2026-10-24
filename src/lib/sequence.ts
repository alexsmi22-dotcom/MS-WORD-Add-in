// Generates a WIPO Standard ST.26 sequence listing (XML) from entered nucleotide
// or amino-acid sequences. ST.26 is the mandatory format for sequence listings in
// patent applications; this produces a well-formed draft covering the common case
// (per-sequence source feature with mol_type + organism qualifiers).
//
// IMPORTANT: this is a drafting aid. The output should be validated in the WIPO
// Sequence tool before filing. Pure string logic — no Office.js, no Date — so it
// is fully unit-testable; the caller supplies the production date.

import { isInitiator, resolveCodon } from "./dna";
import { type GeneticCode, contextStopNote, findGeneticCode, geneticCodeById, geneticCodeLabel } from "./geneticCode";

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

/**
 * What the listing's header lacks for WIPO's DTD (#14 DTD gate), each in words; empty = nothing. The DTD requires the
 * applicant's file reference, or the application identification — and that identification, when given, needs BOTH
 * the office code and the application number. A listing exported without them was invalid against the DTD although
 * the pane said "Generated".
 */
export function st26MetaProblems(meta: SequenceListingMeta): string[] {
  const problems: string[] = [];
  const has = (v?: string): boolean => !!v && v.trim() !== "";
  const anyApp = has(meta.ipOfficeCode) || has(meta.applicationNumber) || has(meta.filingDate);
  if (anyApp && !(has(meta.ipOfficeCode) && has(meta.applicationNumber))) {
    problems.push("The application identification needs both the office code (e.g. US) and the application number.");
  }
  if (!has(meta.applicantFileReference) && !anyApp) {
    problems.push("ST.26 needs the applicant's file reference, or the application's office code and number.");
  }
  return problems;
}

// Allowed residue alphabets (lowercase for nucleotides, uppercase for amino acids).
//
// RNA uses "t", not "u". WIPO ST.26 paragraph 14: "The symbol "t" will be
// construed as thymine in DNA and uracil in RNA" (Annex I, Section 1, Table 1
// lists t as "thymine in DNA/uracil in RNA (t/u)"; there is no "u" symbol). The
// alphabet used to be "acgu…", so every t typed into an RNA box was DROPPED as
// invalid and a listing written with u was rejected by WIPO Sequence. A typed u
// in an RNA entry is now written as t, and featureNotes says so.
const DNA = "acgtryswkmbdhvn";
const RNA = "acgtryswkmbdhvn";
const AA = "ABCDEFGHIJKLMNPQRSTVWYZXUO"; // 20 + ambiguity (B,Z,J,X) + U(Sec) + O(Pyl)

const ALPHABET: Record<MolType, string> = { DNA, RNA, AA };

export interface CleanedResidues {
  /** Valid residues only, normalized case. */
  residues: string;
  length: number;
  /** Distinct invalid characters that were dropped (for a UI warning). */
  invalid: string[];
  /** RNA only: how many typed "u" were written as the ST.26 symbol "t" (paragraph 14). */
  uracilAsT?: number;
}

/** Strips whitespace/digits, normalizes case, and validates against the alphabet. */
export function cleanResidues(moltype: MolType, raw: string): CleanedResidues {
  const letters = raw.replace(/[^A-Za-z]/g, "");
  let normalized = moltype === "AA" ? letters.toUpperCase() : letters.toLowerCase();
  let uracilAsT = 0;
  if (moltype === "RNA") {
    uracilAsT = (normalized.match(/u/g) ?? []).length;
    if (uracilAsT) normalized = normalized.replace(/u/g, "t");
  }
  const allowed = ALPHABET[moltype];
  let residues = "";
  const invalid: Record<string, true> = {};
  for (const ch of normalized) {
    if (allowed.indexOf(ch) >= 0) residues += ch;
    else invalid[ch] = true;
  }
  const out: CleanedResidues = { residues, length: residues.length, invalid: Object.keys(invalid) };
  if (uracilAsT) out.uracilAsT = uracilAsT;
  return out;
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
const DEFINED_RNA = "acgt"; // ST.26 ¶14: t is uracil in RNA
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

/**
 * The next qualifier id. The DTD declares INSDQualifier/@id as an XML ID, which must be unique in the whole
 * DOCUMENT: ids restarted at q1 in every feature, so any listing with a second sequence or feature repeated q1 and
 * failed WIPO's DTD (#14 DTD gate). Numbered q1…qN across the listing; buildSt26Xml resets it.
 */
let qualCount = 0;

/** One `<INSDQualifier>` element, its id unique in the listing. */
function qual(name: string, value: string): string {
  qualCount++;
  return (
    `<INSDQualifier id="q${qualCount}">` +
    el("INSDQualifier_name", name) +
    el("INSDQualifier_value", value) +
    "</INSDQualifier>"
  );
}

/** True when the organism of record resolves to ST.26's "synthetic construct" (blank defaults to it). */
function isSyntheticConstruct(organism: string | undefined): boolean {
  const org = (organism ?? "").trim() || "synthetic construct";
  return org.toLowerCase() === "synthetic construct";
}

/** The mol_type ST.26 ¶84(a) requires for a synthetic construct of this molecule ("other DNA" / "other RNA"). */
const SYNTHETIC_MOL_TYPE: Record<MolType, string> = { DNA: "other DNA", RNA: "other RNA", AA: "protein" };

/**
 * The source mol_type written to the listing. WIPO ST.26 paragraph 84(a): "If the
 * sequence is not naturally occurring, i.e. the value of the "organism"
 * qualifier is "synthetic construct", the "mol_type" qualifier value must be
 * either "other RNA" or "other DNA"". The pane's dropdown starts on "genomic
 * DNA" and a blank organism means "synthetic construct", so the default card
 * used to file genomic DNA from a synthetic construct — a pairing the standard
 * forbids. Such a pairing is now written as other DNA/RNA (featureWarnings says so).
 */
function resolvedMolType(moltype: MolType, organism: string | undefined, sourceMolType?: string): string {
  const molType =
    sourceMolType && MOL_TYPE_OPTIONS[moltype].indexOf(sourceMolType) >= 0 ? sourceMolType : MOL_TYPE_QUAL[moltype];
  if (moltype !== "AA" && isSyntheticConstruct(organism) && molType !== "other DNA" && molType !== "other RNA") {
    return SYNTHETIC_MOL_TYPE[moltype];
  }
  return molType;
}

function sourceFeatureInner(moltype: MolType, length: number, organism: string, sourceMolType?: string): string {
  const org = organism.trim() || "synthetic construct";
  // Use the caller's mol_type only if it's valid for this molecule; else default; ST.26 ¶84(a) for synthetic constructs.
  const molType = resolvedMolType(moltype, organism, sourceMolType);
  return (
    "<INSDFeature>" +
    el("INSDFeature_key", "source") +
    el("INSDFeature_location", `1..${length}`) +
    "<INSDFeature_quals>" +
    qual("mol_type", molType) +
    qual("organism", org) +
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
export function translateCds(nucleotides: string, codonStart: 1 | 2 | 3 = 1, options: CdsTranslateOptions = {}): string {
  let protein = "";
  for (const aa of translateCodons(nucleotides, codonStart, options)) {
    if (aa === "*") break;
    protein += aa;
  }
  return protein;
}

/**
 * The first IN-FRAME stop codon that is not the CDS's last codon, or null.
 *
 * translateCds stops at the first stop, so a CDS 1..24 reading
 * ATG AAA TAG CCC GGG TTT AAA TAA used to emit /translation="MK" beside a
 * location claiming eight codons: the listing contradicted itself, and the
 * protein of record was a truncation. Read on the same path as translateCds
 * (table, initiator rule, /transl_except), so a Sec exception at TGA is not a stop.
 */
export function cdsInternalStop(
  nucleotides: string,
  codonStart: 1 | 2 | 3 = 1,
  options: CdsTranslateOptions = {},
): { codon: number; triplet: string; offset: number } | null {
  const aas = translateCodons(nucleotides, codonStart, options);
  const s = nucleotides.toUpperCase().replace(/U/g, "T");
  for (let k = 0; k < aas.length - 1; k++) {
    if (aas[k] === "*") {
      const offset = codonStart - 1 + 3 * k;
      return { codon: k + 1, triplet: s.substring(offset, offset + 3), offset };
    }
  }
  return null;
}

/** Every complete codon read to one residue ("*" for a stop), not stopping. */
function translateCodons(nucleotides: string, codonStart: 1 | 2 | 3, options: CdsTranslateOptions): string[] {
  const table = options.table ?? 1;
  const code = geneticCodeById(table);
  const s = nucleotides.toUpperCase().replace(/U/g, "T");
  const out: string[] = [];
  for (let i = codonStart - 1, n = 0; i + 3 <= s.length; i += 3, n++) {
    const codon = s.substring(i, i + 3);
    // Initiator rule: a 5′-complete CDS (codon_start 1) whose first codon is an
    // initiation codon of the table is read from Met — GTG → M under table 11,
    // ATT → M under table 2. A CDS at codon_start 2/3 is 5′-partial: no rule.
    let aa = i === 0 && options.initiator && isInitiator(code, codon) ? "M" : resolveCodon(codon, table);
    // /transl_except is the drafter's explicit per-codon instruction and is
    // applied LAST, on top of the table and the initiator rule: it always wins.
    // Applied before the stop test, so (pos:…,aa:Sec) at a TGA reads U and the
    // translation continues, and aa:TERM ends it.
    const ex = options.exceptions?.get(n);
    if (ex !== undefined) aa = ex;
    out.push(aa);
  }
  return out;
}

export interface CdsTranslateOptions {
  /** NCBI genetic code id (the /transl_table value). Default 1. */
  table?: number;
  /** Apply the initiator rule to the first codon (only ever at codon_start 1). Default false. */
  initiator?: boolean;
  /** /transl_except: 0-based codon index (from codon_start) → one-letter residue, "*" for TERM. */
  exceptions?: ReadonlyMap<number, string>;
}

/**
 * INSDC three-letter amino-acid abbreviations accepted in /transl_except
 * (INSDC Feature Table Definition: the /transl_except qualifier, value
 * `(pos:location,aa:<amino_acid>)`, and its amino-acid abbreviation list,
 * with TERM = termination codon and OTHER = any other amino acid).
 */
const TRANSL_EXCEPT_AA: Readonly<Record<string, string>> = {
  ala: "A", arg: "R", asn: "N", asp: "D", cys: "C", gln: "Q", glu: "E", gly: "G", his: "H", ile: "I",
  leu: "L", lys: "K", met: "M", phe: "F", pro: "P", ser: "S", thr: "T", trp: "W", tyr: "Y", val: "V",
  sec: "U", pyl: "O", asx: "B", glx: "Z", xle: "J", xaa: "X", other: "X", term: "*",
};

type TranslExcept = { kind: "ok"; map: Map<number, string> } | { kind: "refused"; message: string };

/**
 * Reads every /transl_except of a CDS into codon index → residue. INSDC form:
 * `(pos:<base span>,aa:<abbrev>)`, the span in SEQUENCE coordinates covering
 * exactly one codon of the CDS reading frame. Anything else (complement(),
 * a partial 1–2-base terminal codon, a span off the frame or outside the CDS,
 * an unknown abbreviation, two different values for one codon) is refused, so
 * no auto-translation is generated and featureWarnings says why — never a
 * translation that silently ignores the drafter's exception.
 */
function readTranslExcept(
  qualifiers: readonly St26Qualifier[] | undefined,
  location: string,
  codonStart: 1 | 2 | 3,
  regionLength: number,
): TranslExcept {
  const map = new Map<number, string>();
  const values = (qualifiers ?? [])
    .filter((q) => q.name.trim().toLowerCase() === "transl_except" && q.value.trim())
    .map((q) => q.value.trim());
  const locMatch = /^(\d+)\.\.(\d+)$/.exec(location.trim());
  const cdsStart = location.trim() ? (locMatch ? parseInt(locMatch[1], 10) : NaN) : 1;
  for (const v of values) {
    const m = /^\(\s*pos\s*:\s*(\d+)\s*\.\.\s*(\d+)\s*,\s*aa\s*:\s*([A-Za-z]+)\s*\)$/.exec(v);
    if (!m || !Number.isFinite(cdsStart)) {
      return { kind: "refused", message: `its /transl_except "${v}" is not a simple (pos:start..end,aa:Xxx) codon this tool can apply` };
    }
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const aa = TRANSL_EXCEPT_AA[m[3].toLowerCase()];
    if (aa === undefined) {
      return { kind: "refused", message: `its /transl_except names "${m[3]}", which is not an INSDC amino-acid abbreviation` };
    }
    const offset = a - cdsStart - (codonStart - 1);
    if (b - a !== 2 || offset < 0 || offset % 3 !== 0 || b - cdsStart + 1 > regionLength) {
      return { kind: "refused", message: `its /transl_except "${v}" is not one in-frame codon inside the CDS` };
    }
    const idx = offset / 3;
    const prev = map.get(idx);
    if (prev !== undefined && prev !== aa) {
      return { kind: "refused", message: `it carries conflicting /transl_except values for bases ${a}..${b}` };
    }
    map.set(idx, aa);
  }
  return { kind: "ok", map };
}

/**
 * The /transl_table qualifier of a CDS, read ONE way for both the XML and the
 * warnings (so a junk value can never suppress the translation silently, or warn
 * while still translating).
 *   absent  — no qualifier: table 1 by INSDC convention, no initiator rule, so
 *             every listing without the qualifier is byte-for-byte unchanged;
 *   ok      — an explicit, valid table: translate with it, initiator rule on;
 *   refused — junk, a retired/unknown id, conflicting values, or a table whose
 *             stops depend on context (27, 28, 31): NO /translation is generated
 *             and the warning says why.
 */
type TranslTable = { kind: "absent" } | { kind: "ok"; code: GeneticCode } | { kind: "refused"; message: string };

function readTranslTable(qualifiers: readonly St26Qualifier[] | undefined): TranslTable {
  const values = (qualifiers ?? [])
    .filter((q) => q.name.trim().toLowerCase() === "transl_table" && q.value.trim())
    .map((q) => q.value.trim());
  if (!values.length) return { kind: "absent" };
  if (values.some((v) => v !== values[0])) {
    return { kind: "refused", message: `it carries conflicting /transl_table values (${values.join(", ")})` };
  }
  const v = values[0];
  if (!/^[1-9][0-9]{0,3}$/.test(v)) {
    return { kind: "refused", message: `its /transl_table value "${v}" is not a genetic-code number` };
  }
  const found = findGeneticCode(parseInt(v, 10));
  if (!found.ok) return { kind: "refused", message: found.message };
  if (found.code.contextStops.length) {
    return { kind: "refused", message: contextStopNote(found.code) + " The CDS end cannot be called from the sequence" };
  }
  return { kind: "ok", code: found.code };
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
    // /transl_table used to be ignored: a table-2 CDS was emitted with a
    // standard-code /translation (MR for M), a table-11 GTG-initiated CDS as
    // V… where INSDC gives M… — the listing contradicted its own qualifier.
    // An unusable value now suppresses the auto-translation (featureWarnings
    // says why) rather than guessing the code. Nothing adds /transl_table: the
    // drafter's qualifier passes through as typed, and INSDC omits table 1.
    const tt = readTranslTable(quals);
    // Honour a drafter-supplied /codon_start rather than translating from base
    // 1 regardless — the two used to disagree in the emitted XML.
    const supplied = quals.find((q) => q.name.toLowerCase() === "codon_start");
    const codonStart = readCodonStart(supplied?.value);
    const te = region !== null ? readTranslExcept(quals, location, codonStart, region.length) : null;
    if (region !== null && !has("translation") && tt.kind !== "refused" && te !== null && te.kind === "ok") {
      // The initiator rule applies only when /transl_table is EXPLICIT (scope §E10):
      // applying it to qualifier-less table-1 CDSs (TTG/CTG are table-1 starts)
      // would change emitted XML product-wide and is a separate decision.
      const opts: CdsTranslateOptions =
        tt.kind === "ok" ? { table: tt.code.id, initiator: codonStart === 1, exceptions: te.map } : { exceptions: te.map };
      // An in-frame stop before the last codon: no /translation (featureWarnings says why).
      const protein = cdsInternalStop(region, codonStart, opts) ? "" : translateCds(region, codonStart, opts);
      if (protein) {
        if (!supplied) quals.push({ name: "codon_start", value: "1" });
        quals.push({ name: "translation", value: protein });
      }
    }
  }
  const qualsXml = quals.length
    ? "<INSDFeature_quals>" + quals.map((q) => qual(q.name, q.value)).join("") + "</INSDFeature_quals>"
    : "";
  return "<INSDFeature>" + el("INSDFeature_key", key) + el("INSDFeature_location", location) + qualsXml + "</INSDFeature>";
}

/** Advisory warnings for a sequence's features (frame/location sanity). */
export function featureWarnings(entry: SequenceEntry): string[] {
  const warnings: string[] = [];
  const { residues } = cleanResidues(entry.moltype, entry.residues);
  for (const f of entry.features ?? []) {
    if (f.key.trim().toUpperCase() !== "CDS" || entry.moltype === "AA") continue;
    const tt = readTranslTable(f.qualifiers);
    if (tt.kind === "refused") {
      const suppliedTranslation = (f.qualifiers ?? []).some(
        (q) => q.name.trim().toLowerCase() === "translation" && q.value.trim(),
      );
      const why = tt.message.replace(/\.\s*$/, "");
      warnings.push(
        suppliedTranslation
          ? `CDS (${f.location || "whole"}): ${why}. Your /translation was kept as typed; fix the /transl_table qualifier before filing.`
          : `CDS (${f.location || "whole"}): no /translation was generated — ${why}. Fix the /transl_table qualifier or supply /translation yourself.`,
      );
    }
    const region = cdsRegion(f.location, residues);
    if (region === null) {
      warnings.push(`CDS location "${f.location}" isn't a simple start..end range — add /translation manually and verify in WIPO Sequence.`);
      continue;
    }
    {
      const cs = (f.qualifiers ?? []).find((q) => q.name.trim().toLowerCase() === "codon_start");
      const te = readTranslExcept(f.qualifiers, f.location, readCodonStart(cs?.value), region.length);
      const hasTranslation = (f.qualifiers ?? []).some((q) => q.name.trim().toLowerCase() === "translation" && q.value.trim());
      if (te.kind === "refused" && !hasTranslation && tt.kind !== "refused") {
        warnings.push(
          `CDS (${f.location || "whole"}): no /translation was generated — ${te.message}. Fix the /transl_except qualifier or supply /translation yourself.`,
        );
      }
      if (te.kind === "ok" && tt.kind !== "refused") {
        const cs1 = readCodonStart(cs?.value);
        const opts: CdsTranslateOptions =
          tt.kind === "ok" ? { table: tt.code.id, initiator: cs1 === 1, exceptions: te.map } : { exceptions: te.map };
        const stop = cdsInternalStop(region, cs1, opts);
        if (stop) {
          const locStart = /^(\d+)\.\./.exec(f.location.trim());
          const base0 = locStart ? parseInt(locStart[1], 10) : 1;
          const a = base0 + stop.offset;
          warnings.push(
            `CDS (${f.location || "whole"}) has an in-frame stop codon ${stop.triplet} at bases ${a}..${a + 2} ` +
              `(codon ${stop.codon}) before its last codon` +
              (hasTranslation
                ? " — check the location and reading frame; your /translation was kept as typed."
                : " — no /translation was generated. Check the location and reading frame, or supply /translation yourself."),
          );
        }
      }
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

/**
 * Informational notes for each auto-translated CDS that used an explicit
 * /transl_table: which genetic code was applied and whether the initiator rule
 * turned the first codon into M. Empty for listings without the qualifier (the
 * table-1 default) — those are unchanged and need no note.
 */
export function featureNotes(entry: SequenceEntry): string[] {
  const notes: string[] = [];
  if (entry.moltype === "AA") return notes;
  const { residues, uracilAsT } = cleanResidues(entry.moltype, entry.residues);
  if (uracilAsT) {
    notes.push(
      `${uracilAsT} “u” written as “t”: WIPO ST.26 paragraph 14 construes “t” as uracil in RNA and has no “u” symbol, ` +
        "so WIPO Sequence rejects a u in the listing.",
    );
  }
  const chosen =
    entry.sourceMolType && MOL_TYPE_OPTIONS[entry.moltype].indexOf(entry.sourceMolType) >= 0
      ? entry.sourceMolType
      : MOL_TYPE_QUAL[entry.moltype];
  const written = resolvedMolType(entry.moltype, entry.organism, entry.sourceMolType);
  if (written !== chosen) {
    notes.push(
      `mol_type “${chosen}” was written as “${written}”: the organism is “synthetic construct”, and WIPO ST.26 ` +
        "paragraph 84(a) requires mol_type “other DNA” or “other RNA” for a sequence that is not naturally occurring. " +
        "If the sequence is naturally occurring, enter its source organism instead.",
    );
  }
  for (const f of entry.features ?? []) {
    if (f.key.trim().toUpperCase() !== "CDS") continue;
    const tt = readTranslTable(f.qualifiers);
    if (tt.kind !== "ok") continue;
    const hasTranslation = (f.qualifiers ?? []).some((q) => q.name.trim().toLowerCase() === "translation" && q.value.trim());
    const region = cdsRegion(f.location, residues);
    if (hasTranslation || region === null) continue;
    const supplied = (f.qualifiers ?? []).find((q) => q.name.trim().toLowerCase() === "codon_start" && q.value.trim());
    const codonStart = readCodonStart(supplied?.value);
    // Same computation as featureInner: no protein → no /translation emitted → no note.
    const te = readTranslExcept(f.qualifiers, f.location, codonStart, region.length);
    if (te.kind === "refused") continue;
    const opts: CdsTranslateOptions = { table: tt.code.id, initiator: codonStart === 1, exceptions: te.map };
    if (cdsInternalStop(region, codonStart, opts)) continue; // no /translation was emitted
    const protein = translateCds(region, codonStart, opts);
    if (!protein) continue;
    let note = `CDS (${f.location || "whole"}): /translation generated with ${geneticCodeLabel(tt.code)}`;
    const first = region.toUpperCase().replace(/U/g, "T").substring(0, 3);
    if (codonStart === 1 && !te.map.has(0) && isInitiator(tt.code, first) && resolveCodon(first, tt.code.id) !== "M") {
      note += `; the first codon ${first} is an initiation codon of table ${tt.code.id} and is read as M (initiator rule)`;
    }
    notes.push(note + ".");
  }
  return notes;
}

function sequenceData(entry: SequenceEntry, idNumber: number): string {
  const { residues, length } = cleanResidues(entry.moltype, entry.residues);
  // The source feature first, then the others: qualifier ids are numbered in document order (q1 is the source's).
  const source = sourceFeatureInner(entry.moltype, length, entry.organism ?? "", entry.sourceMolType);
  const features = (entry.features ?? []).map((f) => featureInner(f, entry.moltype, residues)).join("");
  return (
    `<SequenceData sequenceIDNumber="${idNumber}"><INSDSeq>` +
    el("INSDSeq_length", String(length)) +
    el("INSDSeq_moltype", entry.moltype) +
    el("INSDSeq_division", "PAT") +
    "<INSDSeq_feature-table>" +
    source +
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

  // Whitespace-only fields count as empty, as st26MetaProblems counts them (an IPOfficeCode of "  " was written).
  const t = (v?: string): string => (v ?? "").trim();
  const appId =
    t(meta.ipOfficeCode) || t(meta.applicationNumber) || t(meta.filingDate)
      ? "<ApplicationIdentification>" +
        (t(meta.ipOfficeCode) ? el("IPOfficeCode", t(meta.ipOfficeCode)) : "") +
        (t(meta.applicationNumber) ? el("ApplicationNumberText", t(meta.applicationNumber)) : "") +
        (t(meta.filingDate) ? el("FilingDate", t(meta.filingDate)) : "") +
        "</ApplicationIdentification>"
      : "";

  const fileRef = t(meta.applicantFileReference)
    ? el("ApplicantFileReference", t(meta.applicantFileReference))
    : "";

  // Sequences below the ST.26 minimum are EXCLUDED — not numbered, not counted.
  // They were previously emitted anyway, numbered and counted in
  // SequenceTotalQuantity, after the pane had already told the user they were too
  // short: the document declared itself compliant while carrying entries the
  // standard forbids. Of the two consistent behaviours, exclusion is the one that
  // produces a filable document; the cost is renumbering, which is exactly what
  // `st26Exclusions` exists to make the caller confront BEFORE it builds.
  const listed = entries.filter((e) => !belowSt26Minimum(e));
  qualCount = 0;

  const body =
    appId +
    fileRef +
    `<ApplicantName languageCode="en">${escapeXml(meta.applicantName)}</ApplicantName>` +
    `<InventionTitle languageCode="en">${escapeXml(meta.inventionTitle)}</InventionTitle>` +
    el("SequenceTotalQuantity", String(listed.length)) +
    listed.map((e, i) => sequenceData(e, i + 1)).join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    // "Sequence Listing", not the DTD comment's "SEQUENCE LISTING": checked 2026-10-21 against WIPO's own
    // ST.26 / WIPO Sequence training (PCT webinar 2025-24, "Document type (DOCTYPE) declaration"), which writes
    // this line character for character. Do not "fix" the case to match Annex II's comment.
    `<!DOCTYPE ST26SequenceListing PUBLIC "-//WIPO//DTD Sequence Listing 1.3//EN" "ST26SequenceListing_${DTD_VERSION}.dtd">\n` +
    `<ST26SequenceListing ${rootAttrs}>` +
    body +
    "</ST26SequenceListing>\n"
  );
}

/**
 * Guesses ST.26's molecule type from the residues themselves.
 *
 * Deliberately conservative and stated in the result: DNA unless there is a U
 * with no T (RNA), or letters outside the nucleotide alphabet (protein). A
 * short peptide of only GATC-type letters is genuinely ambiguous — "CAT" is a
 * valid tripeptide and a valid codon — so it reads as DNA and the user changes
 * the dropdown. Guessing silently would be worse than guessing visibly.
 */
export function guessMolType(residues: string): MolType {
  const r = residues.toUpperCase().replace(/[^A-Z]/g, "");
  if (!r) return "DNA";
  const nucleotide = /^[ACGTUNRYKMSWBDHV]+$/.test(r);
  if (!nucleotide) return "AA";
  return r.includes("U") && !r.includes("T") ? "RNA" : "DNA";
}
