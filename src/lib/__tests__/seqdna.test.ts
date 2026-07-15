// SnapGene .dna reader tests.
//
// ---------------------------------------------------------------------------
// WHAT THESE DO AND DON'T PROVE — this matters.
//
// The .dna format is proprietary and undocumented by its vendor. This reader is
// written from a third-party reverse-engineering write-up, and these tests build
// synthetic files to that same write-up. So they genuinely test the PARSER — the
// packet walking, framing, flags, XML reading, and every failure path — but they
// CANNOT confirm the write-up itself is correct. Testing my code against my own
// understanding of the format is circular, and no real .dna file was available.
//
// Hence the emphasis below on FAILING CLEANLY: if the format understanding is
// wrong, a real file must produce a clear "export as GenBank instead" rather than
// a plausible-looking wrong sequence. That is the property these tests can and do
// establish.
// ---------------------------------------------------------------------------

import { parseSnapGeneDna, looksLikeDna } from "../seqdna";

/** Builds one packet: tag | big-endian uint32 length | data. */
function packet(tag: number, data: Uint8Array | string): number[] {
  const bytes = typeof data === "string" ? [...data].map((c) => c.charCodeAt(0)) : [...data];
  const len = bytes.length;
  return [tag, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...bytes];
}

const cookie = () => packet(0x09, "SnapGene" + "\x00\x01\x00\x0e\x00\x0e");
const dnaPacket = (seq: string, circular: boolean) => packet(0x00, String.fromCharCode(circular ? 0x02 : 0x00) + seq);

const FEATURES_XML = `<?xml version="1.0"?><Features nextValidID="5">
<Feature recentID="1" name="AmpR" type="CDS" directionality="2">
  <Segment range="1626-2486" color="#ccffcc" type="standard"/>
  <Q name="gene"><V text="bla"/></Q>
</Feature>
<Feature recentID="2" name="ori" type="rep_origin" directionality="1">
  <Segment range="867-1455" color="#ffff00" type="standard"/>
</Feature>
<Feature recentID="3" name="lacZ" type="CDS" directionality="1">
  <Segment range="10-100" color="#ccc" type="standard"/>
  <Segment range="150-200" color="#ccc" type="standard"/>
</Feature>
</Features>`;

const PRIMERS_XML = `<?xml version="1.0"?><Primers>
<Primer name="M13 rev" sequence="CAGGAAACAGCTATGAC">
  <BindingSite location="90-106" boundStrand="1" strand="bottom"/>
</Primer>
</Primers>`;

const NOTES_XML = `<?xml version="1.0"?><Notes>
<Type>Synthetic</Type>
<AccessionNumber>pUC19</AccessionNumber>
<Description>A test plasmid</Description>
</Notes>`;

/** A complete, well-formed synthetic .dna file. */
function buildDna(opts: { seq?: string; circular?: boolean; features?: boolean; primers?: boolean; notes?: boolean } = {}): Uint8Array {
  const seq = opts.seq ?? "acgt".repeat(672); // 2688 bp
  const bytes: number[] = [
    ...cookie(),
    ...dnaPacket(seq, opts.circular ?? true),
    ...(opts.notes !== false ? packet(0x06, NOTES_XML) : []),
    ...(opts.features !== false ? packet(0x0a, FEATURES_XML) : []),
    ...(opts.primers !== false ? packet(0x05, PRIMERS_XML) : []),
  ];
  return new Uint8Array(bytes);
}

const ok = (r: ReturnType<typeof parseSnapGeneDna>) => {
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error}`);
  return r.record;
};

describe("packet framing", () => {
  test("reads a well-formed file", () => {
    const rec = ok(parseSnapGeneDna(buildDna()));
    expect(rec.length).toBe(2688);
    expect(rec.sequence).toMatch(/^[ACGT]+$/);
    expect(rec.circular).toBe(true);
  });

  test("the circular flag is bit 1 of the DNA packet's first byte", () => {
    expect(ok(parseSnapGeneDna(buildDna({ circular: true }))).circular).toBe(true);
    expect(ok(parseSnapGeneDna(buildDna({ circular: false }))).circular).toBe(false);
  });

  test("an unknown packet is SKIPPED by its length, not interpreted", () => {
    // The whole point of a length-prefixed format: a tag we don't understand
    // must not derail the ones we do.
    const bytes = new Uint8Array([
      ...cookie(),
      ...packet(0x42, "some future packet we know nothing about"),
      ...dnaPacket("acgtacgt", true),
      ...packet(0x99, "another"),
      ...packet(0x0a, FEATURES_XML),
    ]);
    const rec = ok(parseSnapGeneDna(bytes));
    expect(rec.sequence).toBe("ACGTACGT");
    expect(rec.features.length).toBeGreaterThan(0);
  });

  test("packet order doesn't matter (beyond the cookie coming first)", () => {
    const bytes = new Uint8Array([...cookie(), ...packet(0x0a, FEATURES_XML), ...dnaPacket("acgtacgt", false)]);
    expect(ok(parseSnapGeneDna(bytes)).features.length).toBeGreaterThan(0);
  });
});

describe("features", () => {
  test("reads name, type, span and strand", () => {
    const rec = ok(parseSnapGeneDna(buildDna()));
    const amp = rec.features.find((f) => f.name === "AmpR" || f.name === "bla")!;
    expect(amp).toBeDefined();
    expect(amp.type).toBe("CDS");
    expect(amp.start).toBe(1626);
    expect(amp.end).toBe(2486);
    expect(amp.strand).toBe(-1); // directionality="2"
  });

  test("directionality 1 is forward", () => {
    const ori = ok(parseSnapGeneDna(buildDna())).features.find((f) => f.name === "ori")!;
    expect(ori.strand).toBe(1);
  });

  test("multiple Segments become multiple segments (a joined CDS)", () => {
    const lacZ = ok(parseSnapGeneDna(buildDna())).features.find((f) => f.name === "lacZ")!;
    expect(lacZ.segments).toEqual([
      { start: 10, end: 100 },
      { start: 150, end: 200 },
    ]);
    expect(lacZ.start).toBe(10);
    expect(lacZ.end).toBe(200);
  });

  test("primers become primer_bind features with their strand", () => {
    const p = ok(parseSnapGeneDna(buildDna())).features.find((f) => f.type === "primer_bind")!;
    expect(p.name).toBe("M13 rev");
    expect(p.start).toBe(90);
    expect(p.strand).toBe(-1); // strand="bottom"
  });

  test("a feature with no readable range is skipped, not placed at a guess", () => {
    const bad = `<Features><Feature name="x" type="CDS"><Segment range="not-a-range"/></Feature></Features>`;
    const bytes = new Uint8Array([...cookie(), ...dnaPacket("acgt", false), ...packet(0x0a, bad)]);
    expect(ok(parseSnapGeneDna(bytes)).features).toHaveLength(0);
  });

  test("notes supply the name and description", () => {
    const rec = ok(parseSnapGeneDna(buildDna()));
    expect(rec.name).toBe("pUC19");
    expect(rec.description).toBe("A test plasmid");
  });

  test("a file with no features still yields its sequence", () => {
    const rec = ok(parseSnapGeneDna(buildDna({ features: false, primers: false })));
    expect(rec.length).toBe(2688);
    expect(rec.features).toEqual([]);
  });
});

describe("FAILS CLEANLY — the property that matters most here", () => {
  // Because the format understanding is unverified against a real file, the
  // reader's most important job is to refuse anything it doesn't recognise and
  // point at GenBank, rather than emit a plausible-looking wrong sequence.

  test("a non-SnapGene file is refused and names the way out", () => {
    const r = parseSnapGeneDna(new Uint8Array([...Array(50).keys()]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/GenBank/);
  });

  test("a GenBank file fed here by mistake is refused", () => {
    const gb = "LOCUS  pTEST  100 bp  DNA  circular\nORIGIN\n  1 acgt\n//";
    const r = parseSnapGeneDna(new Uint8Array([...gb].map((c) => c.charCodeAt(0))));
    expect(r.ok).toBe(false);
  });

  test("a file missing the magic cookie is refused even if the rest looks right", () => {
    const bytes = new Uint8Array([...packet(0x09, "NotGene!" + "\x00\x01\x00\x0e"), ...dnaPacket("acgt", true)]);
    const r = parseSnapGeneDna(bytes);
    expect(r.ok).toBe(false);
  });

  test("a truncated file is refused rather than half-read", () => {
    const full = buildDna();
    const r = parseSnapGeneDna(full.subarray(0, 8));
    expect(r.ok).toBe(false);
  });

  test("a packet whose length runs past the buffer stops the walk", () => {
    // A corrupt or misunderstood length must not cause arbitrary bytes to be
    // reinterpreted as packets.
    const bytes = new Uint8Array([...cookie(), ...dnaPacket("acgtacgt", true), 0x0a, 0xff, 0xff, 0xff, 0xff, 0x01]);
    const rec = ok(parseSnapGeneDna(bytes));
    expect(rec.sequence).toBe("ACGTACGT"); // the good packets survived
    expect(rec.features).toEqual([]); // the bad one was dropped, not guessed
  });

  test("a file with no DNA packet is refused", () => {
    const bytes = new Uint8Array([...cookie(), ...packet(0x0a, FEATURES_XML)]);
    const r = parseSnapGeneDna(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No sequence|GenBank/);
  });

  test("an empty sequence is refused", () => {
    const bytes = new Uint8Array([...cookie(), ...dnaPacket("", true)]);
    expect(parseSnapGeneDna(bytes).ok).toBe(false);
  });

  test("empty input is refused", () => {
    expect(parseSnapGeneDna(new Uint8Array(0)).ok).toBe(false);
    expect(parseSnapGeneDna(new Uint8Array(3)).ok).toBe(false);
  });

  test("never throws, whatever the bytes", () => {
    const cases = [
      new Uint8Array(0),
      new Uint8Array([0x09]),
      new Uint8Array(1000).fill(0xff),
      new Uint8Array([...cookie()]),
      new Uint8Array([...cookie(), 0x00]),
    ];
    for (const c of cases) expect(() => parseSnapGeneDna(c)).not.toThrow();
  });
});

describe("looksLikeDna sniffing", () => {
  test("recognises the magic cookie", () => {
    expect(looksLikeDna(buildDna())).toBe(true);
  });

  test("rejects everything else", () => {
    expect(looksLikeDna(new Uint8Array([...">seq\nACGT"].map((c) => c.charCodeAt(0))))).toBe(false);
    expect(looksLikeDna(new Uint8Array(20))).toBe(false);
    expect(looksLikeDna(new Uint8Array(2))).toBe(false);
  });
});
