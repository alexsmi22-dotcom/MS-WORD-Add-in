// SnapGene .dna file reader.
//
// ---------------------------------------------------------------------------
// HONESTY, UP FRONT — read this before trusting it.
//
// The .dna format is PROPRIETARY and UNDOCUMENTED by its vendor. This reader is
// written from a third-party reverse-engineering write-up (incenp.org's binary
// sequence formats notes), not from a specification. It has been tested against
// synthetic files built to that write-up — which exercises the packet walking,
// the XML parsing and the flag handling, but CANNOT confirm that the write-up
// itself is right. No real .dna file was available to validate against.
//
// So: this is a convenience, not the supported path. It is written to FAIL
// CLEANLY — an unrecognised or unexpected file returns an error telling the user
// to export GenBank instead, which every tool including SnapGene can do and which
// IS fully validated (against real NCBI records). Nothing is guessed: a packet we
// don't understand is skipped by its declared length, never interpreted.
// ---------------------------------------------------------------------------
//
// Format, as documented by that write-up:
//
//   Each packet:  1 byte tag | 4 bytes big-endian length | <length> bytes data
//   0x09  cookie    "SnapGene" magic + 3 uint16 — must be the first packet
//   0x00  DNA       1 flag byte (bit 1 = circular) then the sequence as ASCII
//   0x0A  features  XML: <Features><Feature …><Segment range="a-b"/></Feature>…
//   0x05  primers   XML: <Primers><Primer …>
//   0x06  notes     XML: <Notes> — description, dates, accession
//
// Pure: bytes in, SeqRecord out. No DOM (DOMParser isn't available in the lib
// tests), so the small amount of XML is read with tolerant regex — the shapes
// are simple and fixed, and a mis-read attribute is skipped, never invented.

import { SeqRecord, SeqFeature, FeatureSegment } from "./seqio";

const TAG_COOKIE = 0x09;
const TAG_DNA = 0x00;
const TAG_PRIMERS = 0x05;
const TAG_NOTES = 0x06;
const TAG_FEATURES = 0x0a;

export type DnaParse = { ok: true; record: SeqRecord } | { ok: false; error: string };

interface Packet {
  tag: number;
  data: Uint8Array;
}

/** Walks the packet stream. Unknown packets are skipped by their length. */
function readPackets(bytes: Uint8Array): Packet[] | null {
  const out: Packet[] = [];
  let i = 0;
  while (i + 5 <= bytes.length) {
    const tag = bytes[i];
    // Big-endian uint32 length.
    const len = ((bytes[i + 1] << 24) >>> 0) + (bytes[i + 2] << 16) + (bytes[i + 3] << 8) + bytes[i + 4];
    const start = i + 5;
    const end = start + len;
    // A length running past the buffer means we've lost the frame — stop rather
    // than reinterpret arbitrary bytes as a packet.
    if (len < 0 || end > bytes.length) return out.length ? out : null;
    out.push({ tag, data: bytes.subarray(start, end) });
    i = end;
  }
  return out;
}

const ascii = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** UTF-8-ish decode for the XML packets. */
function decodeUtf8(b: Uint8Array): string {
  try {
    // TextDecoder exists in the pane and in node's test env.
    return new TextDecoder("utf-8").decode(b);
  } catch {
    return ascii(b);
  }
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};

/**
 * Reads the <Features> XML.
 *
 * A Feature carries name/type/directionality; its Segment children carry the
 * ranges. Directionality 1 = forward, 2 = reverse, 3 = bidirectional — anything
 * other than 2 is treated as forward, which is the safe reading: mislabelling a
 * forward feature as reverse would flip an arrow on the map.
 */
function parseFeaturesXml(xml: string): SeqFeature[] {
  const out: SeqFeature[] = [];
  // An exec loop rather than matchAll: the project targets ES2017, and moving
  // the whole build's goalposts for one convenience method isn't worth it.
  const featRe = /<Feature\b([^>]*)>([\s\S]*?)<\/Feature>|<Feature\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = featRe.exec(xml)) !== null) {
    const head = m[1] ?? m[3] ?? "";
    const body = m[2] ?? "";
    const name = attr(head, "name") ?? attr(head, "type") ?? "feature";
    const type = attr(head, "type") ?? "misc_feature";
    const dir = attr(head, "directionality");
    const strand: 1 | -1 = dir === "2" ? -1 : 1;

    const segments: FeatureSegment[] = [];
    const segRe = /<Segment\b([^>]*)\/?>/g;
    let sm: RegExpExecArray | null;
    while ((sm = segRe.exec(body)) !== null) {
      const range = attr(sm[1], "range");
      if (!range) continue;
      const r = /^(\d+)-(\d+)$/.exec(range.trim());
      if (!r) continue;
      const a = Number(r[1]);
      const b = Number(r[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      segments.push({ start: Math.min(a, b), end: Math.max(a, b) });
    }
    // A feature with no readable range can't be drawn; skip it rather than
    // place it at a made-up coordinate.
    if (!segments.length) continue;

    // A better label from a <Q name="label"> qualifier, when present.
    let label = name;
    const q = /<Q name="(?:label|gene|product|note)"[^>]*>([\s\S]*?)<\/Q>/.exec(body);
    if (q) {
      const v = /(?:text|predef)="([^"]*)"/.exec(q[1]);
      if (v) label = unescapeXml(v[1]);
    }

    out.push({
      type,
      name: label.replace(/\s+/g, " ").trim() || type,
      start: Math.min(...segments.map((s) => s.start)),
      end: Math.max(...segments.map((s) => s.end)),
      strand,
      segments,
      qualifiers: {},
    });
  }
  return out;
}

/** Reads the <Primers> XML into primer_bind features. */
function parsePrimersXml(xml: string): SeqFeature[] {
  const out: SeqFeature[] = [];
  const primRe = /<Primer\b([^>]*)>([\s\S]*?)<\/Primer>|<Primer\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = primRe.exec(xml)) !== null) {
    const head = m[1] ?? m[3] ?? "";
    const body = m[2] ?? "";
    const name = attr(head, "name") ?? "primer";
    const site = /<BindingSite\b([^>]*)\/?>/.exec(body);
    if (!site) continue;
    const loc = attr(site[1], "location");
    if (!loc) continue;
    const r = /^(\d+)-(\d+)$/.exec(loc.trim());
    if (!r) continue;
    const a = Number(r[1]);
    const b = Number(r[2]);
    const strandAttr = attr(site[1], "strand");
    const strand: 1 | -1 = strandAttr === "bottom" ? -1 : 1;
    out.push({
      type: "primer_bind",
      name,
      start: Math.min(a, b),
      end: Math.max(a, b),
      strand,
      segments: [{ start: Math.min(a, b), end: Math.max(a, b) }],
      qualifiers: {},
    });
  }
  return out;
}

/**
 * Parses a SnapGene .dna file.
 *
 * Takes raw bytes because the format is binary — reading it as text mangles it.
 */
export function parseSnapGeneDna(bytes: Uint8Array): DnaParse {
  if (bytes.length < 14) return { ok: false, error: "That file is too small to be a SnapGene file." };

  const packets = readPackets(bytes);
  if (!packets || !packets.length) {
    return { ok: false, error: "That doesn't look like a SnapGene file. Export it as GenBank instead." };
  }

  // The cookie must come first, and must actually say SnapGene.
  const cookie = packets[0];
  if (cookie.tag !== TAG_COOKIE || ascii(cookie.data.subarray(0, 8)) !== "SnapGene") {
    return { ok: false, error: "That isn't a SnapGene .dna file. Export it as GenBank instead." };
  }

  const dna = packets.find((p) => p.tag === TAG_DNA);
  if (!dna || dna.data.length < 2) {
    return { ok: false, error: "No sequence found in that SnapGene file. Export it as GenBank instead." };
  }
  // Byte 0 is flags; bit 1 (value 2) marks a circular molecule.
  const circular = (dna.data[0] & 0x02) !== 0;
  const sequence = ascii(dna.data.subarray(1))
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  if (!sequence) {
    return { ok: false, error: "That SnapGene file has an empty sequence." };
  }

  const features: SeqFeature[] = [];
  const fp = packets.find((p) => p.tag === TAG_FEATURES);
  if (fp) features.push(...parseFeaturesXml(decodeUtf8(fp.data)));
  const pp = packets.find((p) => p.tag === TAG_PRIMERS);
  if (pp) features.push(...parsePrimersXml(decodeUtf8(pp.data)));

  // Name and description live in the notes XML, when present.
  let name = "SnapGene construct";
  let description: string | undefined;
  const np = packets.find((p) => p.tag === TAG_NOTES);
  if (np) {
    const notes = decodeUtf8(np.data);
    const t = /<Type>([\s\S]*?)<\/Type>/.exec(notes);
    const d = /<Description>([\s\S]*?)<\/Description>/.exec(notes);
    const a = /<AccessionNumber>([\s\S]*?)<\/AccessionNumber>/.exec(notes);
    if (a && a[1].trim()) name = unescapeXml(a[1].trim());
    if (d && d[1].trim()) description = unescapeXml(d[1].trim()).replace(/<[^>]*>/g, "");
    else if (t && t[1].trim()) description = unescapeXml(t[1].trim());
  }

  // Anything running past the end wraps the origin of a circular molecule.
  for (const f of features) if (f.end > sequence.length) f.wraps = true;

  return {
    ok: true,
    record: {
      name,
      description,
      sequence,
      length: sequence.length,
      circular,
      features,
      // Reported as genbank because it carries the same shape of data; the UI
      // labels the SOURCE separately.
      format: "genbank",
    },
  };
}

/** True if these bytes start with the SnapGene magic cookie. */
export function looksLikeDna(bytes: Uint8Array): boolean {
  return bytes.length > 13 && bytes[0] === TAG_COOKIE && ascii(bytes.subarray(5, 13)) === "SnapGene";
}
