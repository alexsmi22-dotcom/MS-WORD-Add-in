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
  /** 1-based inclusive span across all segments (min start, max end). */
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
  /** Which reader produced this. */
  format: "fasta" | "genbank";
}

export type SeqParse = { ok: true; records: SeqRecord[] } | { ok: false; error: string };

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
      return [{ start: Math.min(a, b), end: Math.max(a, b) }];
    }
    // A single base, or the rare 102^103 (between two bases).
    const single = /^<?>?(\d+)(?:\^(\d+))?$/.exec(text);
    if (single) {
      const a = Number(single[1]);
      const b = single[2] ? Number(single[2]) : a;
      return [{ start: Math.min(a, b), end: Math.max(a, b) }];
    }
    return null;
  };

  const segments = inner(s, 1);
  if (!segments) return null;
  // Work out the strand by re-reading the outermost complement, since `inner`
  // folds it into the recursion.
  const strand: 1 | -1 = /^complement\(/.test(s) ? -1 : 1;
  if (!segments.length) return null;
  return { segments, strand };
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
      const f = buildFeature(cur.key, cur.loc.join(""), cur.quals, sequence.length);
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

  return {
    name: name || "unnamed",
    description,
    sequence,
    length: sequence.length,
    circular,
    features,
    format: "genbank",
  };
}

function buildFeature(key: string, locText: string, quals: string[], seqLen: number): SeqFeature | null {
  if (SKIP_FEATURES.has(key)) return null;
  const loc = parseLocation(locText);
  if (!loc) return null;

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

  const label = LABEL_KEYS.map((k) => qualifiers[k]).find((v) => v && v.trim()) || key;
  const start = Math.min(...loc.segments.map((s) => s.start));
  const end = Math.max(...loc.segments.map((s) => s.end));
  // A feature running past the end means it wraps the origin of a circular
  // plasmid. Flag it rather than silently drawing a bar off the edge.
  const wraps = end > seqLen;

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
