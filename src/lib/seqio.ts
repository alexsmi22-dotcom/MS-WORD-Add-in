// Sequence file readers: FASTA and GenBank.
//
// Why this exists: the pane could compute plenty about a sequence but could not
// READ one. Every sequence had to be pasted as raw text, which loses the thing
// that makes a sequence useful to draw — its FEATURE ANNOTATIONS. A GenBank file
// carries them (promoters, CDS, resistance markers, primers), and SnapGene and
// every other tool can export GenBank, so this is the interchange path that
// reaches their users without touching any proprietary format.
//
// Pure parsing — no DOM, no Office. Returns data; drawing lives in seqmap.ts.

import { minOf, maxOf } from "./minmax";

/** A feature interval. Coordinates are 1-based inclusive, as in the file. */
export interface FeatureSegment {
  start: number;
  end: number;
}

export interface SeqFeature {
  /** GenBank feature key: CDS, promoter, misc_feature, primer_bind… */
  type: string;
  /** Best display label, from /label, /gene, /product, /note — else the type. */
  name: string;
  /**
   * 1-based inclusive span across all segments (min start, max end) — EXCEPT an
   * origin-spanning feature of a circular record (`wraps`), where start > end is
   * possible: start is where it begins (e.g. 2801) and end where it finishes
   * after the origin (e.g. 150). Use featureLength() rather than end − start.
   */
  start: number;
  end: number;
  /** +1 forward, -1 on the complement strand. */
  strand: 1 | -1;
  /** Individual segments — a joined CDS has several (exons). */
  segments: FeatureSegment[];
  /** True when the location ran off the end of the sequence (a wrapped feature on a circular plasmid). */
  wraps?: boolean;
  /** Raw qualifiers, first value wins for repeats. */
  qualifiers: Record<string, string>;
}

export interface SeqRecord {
  name: string;
  /** Upper-case residues, whitespace and numbering stripped. */
  sequence: string;
  length: number;
  circular: boolean;
  features: SeqFeature[];
  /** DEFINITION line, when present. */
  description?: string;
  /**
   * Source organism, when the file states one. GENBANK ONLY — a FASTA file
   * carries no organism, so this stays undefined rather than being guessed at.
   *
   * This field exists because its absence was silently mis-filing patent
   * applications. The pane fed the ST.26 builder an organism read from the
   * `source` FEATURE, which this reader has always removed (SKIP_FEATURES), so
   * the value was always "" and `sequence.ts` substituted its default —
   * "synthetic construct" — onto every imported record, including 40 real
   * GenBank sequences from real organisms. That is a statement of record in a
   * filed application, and WIPO will not reject it because the value is legal.
   */
  organism?: string;
  /** Which reader produced this. */
  format: "fasta" | "genbank";
}

export type SeqParse = { ok: true; records: SeqRecord[] } | { ok: false; error: string };

/**
 * A feature's span in bp, origin-aware: an origin-spanning feature 2801→150 on
 * a 3000 bp ring is (3000 − 2801 + 1) + 150 = 350 bp, not 150 − 2801.
 */
export function featureLength(f: Pick<SeqFeature, "start" | "end">, seqLen: number): number {
  return f.end >= f.start ? f.end - f.start + 1 : seqLen - f.start + 1 + f.end;
}

const RESIDUE_RE = /[^A-Za-z*-]/g;

// ---------------------------------------------------------------------------
// FASTA
// ---------------------------------------------------------------------------

/**
 * Parses FASTA. Multiple records are supported; a file with no ">" header is
 * accepted as a single bare sequence, because that is what people paste.
 */
export function parseFasta(text: string): SeqParse {
  const lines = text.split(/\r?\n/);
  const records: SeqRecord[] = [];
  let name = "";
  let desc = "";
  let seq: string[] = [];

  const flush = () => {
    const s = seq.join("").replace(RESIDUE_RE, "").toUpperCase();
    if (!s) return;
    records.push({
      name: name || `sequence ${records.length + 1}`,
      description: desc || undefined,
      sequence: s,
      length: s.length,
      circular: false, // FASTA carries no topology — never guess it
      features: [], // nor any annotations
      format: "fasta",
    });
    seq = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith(">") || line.startsWith(";")) {
      flush();
      const head = line.slice(1).trim();
      const sp = head.search(/\s/);
      name = sp < 0 ? head : head.slice(0, sp);
      desc = sp < 0 ? "" : head.slice(sp + 1).trim();
      continue;
    }
    seq.push(line);
  }
  flush();

  if (!records.length) return { ok: false, error: "No sequence found in that FASTA file." };
  return { ok: true, records };
}

// ---------------------------------------------------------------------------
// GenBank location grammar
// ---------------------------------------------------------------------------
//
// The fiddly part of GenBank, and where a lazy parser quietly gets things wrong:
//
//   467                  a single base
//   340..565             a range
//   <345..500            the feature starts before the sequence does
//   1..>888              …or continues past the end
//   complement(340..565) on the reverse strand
//   join(12..78,134..202)  one feature, several segments (exons)
//   complement(join(...))  both
//   order(...)           like join, but order isn't guaranteed
//
// Getting `complement` wrong flips an arrow; getting `join` wrong merges two
// exons into one box that spans an intron it should skip.

interface ParsedLocation {
  segments: FeatureSegment[];
  strand: 1 | -1;
}

/** Parses a GenBank location string. Returns null if it can't be understood. */
export function parseLocation(loc: string): ParsedLocation | null {
  const s = loc.replace(/\s+/g, "");
  if (!s) return null;

  // Each segment's own strand, in the order written. The strand used to be read
  // only from an OUTERMOST complement(), so join(complement(1400..1600),
  // complement(1000..1200)) — every exon on the minus strand, the form NCBI
  // writes for minus-strand genes — came back as +1 and its arrow pointed the
  // wrong way.
  const strands: (1 | -1)[] = [];
  const inner = (text: string, strand: 1 | -1): FeatureSegment[] | null => {
    // complement(...) flips the strand for everything inside it.
    const comp = /^complement\((.*)\)$/.exec(text);
    if (comp) return inner(comp[1], strand === 1 ? -1 : 1);

    // join(...) / order(...) — split on top-level commas only.
    const multi = /^(?:join|order)\((.*)\)$/.exec(text);
    if (multi) {
      const parts = splitTopLevel(multi[1]);
      const out: FeatureSegment[] = [];
      for (const p of parts) {
        const seg = inner(p, strand);
        if (!seg) return null;
        out.push(...seg);
      }
      return out;
    }

    // A remote accession (J00194.1:100..202) refers to another record; we can't
    // draw it against this sequence, so skip it rather than mis-place it.
    if (/^[A-Za-z][\w.]*:/.test(text)) return [];

    // <1..>888 — the < and > mean "extends beyond"; the number is still the
    // best coordinate we have.
    const range = /^<?(\d+)\.\.>?(\d+)$/.exec(text);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      strands.push(strand);
      return [{ start: Math.min(a, b), end: Math.max(a, b) }];
    }
    // A single base, or the rare 102^103 (between two bases).
    const single = /^<?>?(\d+)(?:\^(\d+))?$/.exec(text);
    if (single) {
      const a = Number(single[1]);
      const b = single[2] ? Number(single[2]) : a;
      strands.push(strand);
      return [{ start: Math.min(a, b), end: Math.max(a, b) }];
    }
    return null;
  };

  const segments = inner(s, 1);
  if (!segments) return null;
  if (!segments.length) return null;
  // Minus strand when EVERY segment is complemented — complement(join(…)) and
  // join(complement(…),complement(…)) alike. A mixed-strand join is drawn +1.
  const strand: 1 | -1 = strands.length > 0 && strands.every((x) => x === -1) ? -1 : 1;
  return { segments, strand };
}

/**
 * The segments in top-strand 5′→3′ order. complement(join(a,b)) writes them in
 * top-strand order already; join(complement(b),complement(a)) writes them 5′→3′
 * on the minus strand, i.e. reversed.
 */
function forwardOrder(locText: string, loc: ParsedLocation): FeatureSegment[] {
  const outerComplement = /^complement\(/.test(locText.replace(/\s+/g, ""));
  return loc.strand === -1 && !outerComplement ? [...loc.segments].reverse() : loc.segments;
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// GenBank
// ---------------------------------------------------------------------------

/** Feature keys that are structural noise on a map rather than information. */
const SKIP_FEATURES = new Set(["source"]);

/** Qualifiers to use as a label, best first. */
const LABEL_KEYS = ["label", "gene", "product", "note", "standard_name", "bound_moiety", "organism"];

/**
 * Parses a GenBank flat file. Handles multi-record files (separated by `//`).
 *
 * Tolerant by design: real files in the wild have ragged whitespace and vendor
 * quirks, and a reader that throws on the first oddity is useless. Anything it
 * cannot understand is skipped, never guessed at.
 */
export function parseGenBank(text: string): SeqParse {
  const chunks = text
    .split(/^\/\/\s*$/m)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!chunks.length) return { ok: false, error: "That file is empty." };

  const records: SeqRecord[] = [];
  for (const chunk of chunks) {
    const rec = parseGenBankRecord(chunk);
    if (rec) records.push(rec);
  }
  if (!records.length) {
    return { ok: false, error: "No GenBank record found — expected a LOCUS line and an ORIGIN block." };
  }
  return { ok: true, records };
}

function parseGenBankRecord(text: string): SeqRecord | null {
  const lines = text.split(/\r?\n/);
  const locusIdx = lines.findIndex((l) => /^LOCUS\s/.test(l));
  if (locusIdx < 0) return null;

  // LOCUS  NAME  5386 bp  DNA  circular  PHG  18-APR-2018
  const locus = lines[locusIdx];
  const name = (/^LOCUS\s+(\S+)/.exec(locus) || [, ""])[1] as string;
  const circular = /\bcircular\b/i.test(locus);

  let description: string | undefined;
  const defIdx = lines.findIndex((l) => /^DEFINITION\s/.test(l));
  if (defIdx >= 0) {
    const parts = [lines[defIdx].replace(/^DEFINITION\s+/, "")];
    for (let i = defIdx + 1; i < lines.length && /^\s{5,}\S/.test(lines[i]); i++) parts.push(lines[i].trim());
    description = parts.join(" ").trim().replace(/\.$/, "") || undefined;
  }

  // --- SOURCE / ORGANISM ---------------------------------------------------
  //
  //   SOURCE      Homo sapiens (human)
  //     ORGANISM  Homo sapiens
  //               Eukaryota; Metazoa; Chordata; Craniata; …
  //
  // The ORGANISM line carries the scientific name on its OWN line; every line
  // indented below it is the taxonomic LINEAGE, which is not part of the name.
  // Swallowing the continuation lines would file "Homo sapiens Eukaryota;
  // Metazoa; Chordata; …" as the organism of record, so only the ORGANISM line
  // itself is read.
  let organism: string | undefined;
  const orgIdx = lines.findIndex((l) => /^\s{1,6}ORGANISM\s+\S/.test(l));
  if (orgIdx >= 0) organism = cleanOrganism(lines[orgIdx].replace(/^\s*ORGANISM\s+/, ""));

  // --- ORIGIN: the sequence ------------------------------------------------
  const originIdx = lines.findIndex((l) => /^ORIGIN/.test(l));
  let sequence = "";
  if (originIdx >= 0) {
    const buf: string[] = [];
    for (let i = originIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\/\//.test(l) || /^[A-Z]/.test(l)) break;
      buf.push(l.replace(/\d/g, "")); // strip the column numbering
    }
    sequence = buf.join("").replace(RESIDUE_RE, "").toUpperCase();
  }
  if (!sequence) return null;

  // --- FEATURES ------------------------------------------------------------
  const featIdx = lines.findIndex((l) => /^FEATURES\s/.test(l));
  const features: SeqFeature[] = [];
  if (featIdx >= 0) {
    // A feature key sits at column 5; its qualifiers at column 21. Both are
    // continued by further indented lines.
    let cur: { key: string; loc: string[]; quals: string[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const quals = parseQualifiers(cur.quals);
      // The `source` feature is still kept OFF the map (it spans the whole
      // sequence and is structural noise there) — but its /organism qualifier is
      // read before it is dropped. Many exporters (SnapGene among them) write a
      // source feature and no ORGANISM header line, so dropping the feature
      // without reading it is what made every import "synthetic construct".
      if (cur.key === "source" && !organism) organism = cleanOrganism(quals.organism ?? "");
      const f = buildFeature(cur.key, cur.loc.join(""), quals, sequence.length, circular);
      if (f) features.push(f);
      cur = null;
    };
    for (let i = featIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^ORIGIN/.test(l) || /^\/\//.test(l)) break;
      if (/^[A-Z]/.test(l)) break; // a new top-level section (e.g. CONTIG)
      const keyLine = /^ {1,10}(\S+)\s+(.*)$/.exec(l);
      const isQual = /^\s{10,}\//.test(l);
      if (keyLine && !isQual) {
        flush();
        cur = { key: keyLine[1], loc: [keyLine[2].trim()], quals: [] };
        continue;
      }
      if (!cur) continue;
      if (isQual) {
        cur.quals.push(l.trim());
      } else if (/^\s+\S/.test(l)) {
        // A continuation: of the qualifier if we're in one, else of the location.
        if (cur.quals.length) cur.quals[cur.quals.length - 1] += " " + l.trim();
        else cur.loc.push(l.trim());
      }
    }
    flush();
  }

  // Last resort: the SOURCE line. It is read only if neither the ORGANISM line
  // nor a source feature gave one, because SOURCE routinely carries a common
  // name in parentheses ("Homo sapiens (human)") that the other two do not.
  if (!organism) {
    const srcIdx = lines.findIndex((l) => /^SOURCE\s+\S/.test(l));
    if (srcIdx >= 0) organism = cleanOrganism(lines[srcIdx].replace(/^SOURCE\s+/, ""));
  }

  return {
    name: name || "unnamed",
    description,
    sequence,
    length: sequence.length,
    circular,
    features,
    organism,
    format: "genbank",
  };
}

/**
 * Normalises an organism string, and returns undefined for the placeholders
 * GenBank uses when it does not know: "." and "Unknown." Filing "." or
 * "unknown" as the organism of record is not better than filing nothing, and
 * an empty value lets the caller make its own decision.
 */
function cleanOrganism(raw: string): string | undefined {
  // NB: a trailing "." is NOT stripped in general — "Bacillus sp." is a real
  // organism name and "Bacillus sp" is not one.
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || s === ".") return undefined;
  if (/^unknown\.?$/i.test(s) || /^unclassified\.?$/i.test(s)) return undefined;
  return s;
}

/** Splits raw `/key="value"` qualifier lines into a map; first value wins. */
function parseQualifiers(quals: string[]): Record<string, string> {
  const qualifiers: Record<string, string> = {};
  for (const q of quals) {
    const m = /^\/([^=]+)(?:=(.*))?$/.exec(q);
    if (!m) continue;
    const k = m[1].trim();
    if (k in qualifiers) continue; // first value wins
    let v = (m[2] ?? "").trim();
    if (v.startsWith('"')) v = v.replace(/^"/, "").replace(/"$/, "");
    qualifiers[k] = v;
  }
  return qualifiers;
}

function buildFeature(
  key: string,
  locText: string,
  qualifiers: Record<string, string>,
  seqLen: number,
  circular = false
): SeqFeature | null {
  if (SKIP_FEATURES.has(key)) return null;
  const loc = parseLocation(locText);
  if (!loc) return null;

  const label = LABEL_KEYS.map((k) => qualifiers[k]).find((v) => v && v.trim()) || key;
  let start = minOf(loc.segments.map((s) => s.start));
  let end = maxOf(loc.segments.map((s) => s.end));
  // A feature running past the end means it wraps the origin of a circular
  // plasmid. Flag it rather than silently drawing a bar off the edge.
  let wraps = end > seqLen;
  // THE INSDC ORIGIN-SPANNING FORM: join(2801..3000,1..150) on a 3000 bp
  // circular record is ONE 350 bp feature running through the origin. Read as
  // min..max it became 1..3000 — the whole plasmid — and the circular map drew
  // a full ring. Detected strictly: in top-strand order exactly one segment
  // ends at the last base and the next starts at base 1.
  const fwd = forwardOrder(locText, loc);
  if (circular && fwd.length >= 2) {
    let descents = 0;
    let atOrigin = false;
    for (let k = 0; k + 1 < fwd.length; k++) {
      if (fwd[k + 1].start <= fwd[k].end) {
        descents++;
        if (fwd[k].end === seqLen && fwd[k + 1].start === 1) atOrigin = true;
      }
    }
    if (descents === 1 && atOrigin) {
      start = fwd[0].start;
      end = fwd[fwd.length - 1].end;
      wraps = true;
    }
  }

  return {
    type: key,
    name: label.replace(/\s+/g, " ").trim(),
    start,
    end,
    strand: loc.strand,
    segments: loc.segments,
    wraps: wraps || undefined,
    qualifiers,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type SeqFormat = "fasta" | "genbank" | "unknown";

/** Sniffs the format from the content, not the file extension (which lies). */
export function detectFormat(text: string): SeqFormat {
  const head = text.slice(0, 4000);
  if (/^LOCUS\s/m.test(head)) return "genbank";
  if (/^>/m.test(head)) return "fasta";
  // A bare pasted sequence is treated as FASTA by parseFasta.
  if (/^[ACGTUNRYSWKMBDHVacgtunryswkmbdhv\s]+$/.test(head.slice(0, 200)) && /[A-Za-z]/.test(head)) return "fasta";
  return "unknown";
}

/** Parses a sequence file, choosing the reader by sniffing the content. */
export function parseSequenceFile(text: string): SeqParse {
  if (!text.trim()) return { ok: false, error: "That file is empty." };
  switch (detectFormat(text)) {
    case "genbank":
      return parseGenBank(text);
    case "fasta":
      return parseFasta(text);
    default:
      return {
        ok: false,
        error: "Unrecognised file. Expected FASTA (starts with “>”) or GenBank (starts with “LOCUS”).",
      };
  }
}
