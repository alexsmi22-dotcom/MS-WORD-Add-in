// Phase 5 adversarial bug test — sequence I/O, maps, and enzymes.
//
// The job is to BREAK these, not to confirm they work. The failure that matters
// here is never a crash — it is a plausible figure that lies, or a missed site
// that wastes a week at the bench. Attack classes:
//
//   1. Hostile input that should crash, hang, or return nonsense.
//   2. Biological invariants that must hold for EVERY input.
//   3. Cross-module consistency (the parser and the map must agree).
//   4. Honesty — out-of-domain must be disclosed, never guessed.

import { parseSequenceFile, parseGenBank, parseFasta, parseLocation, SeqRecord } from "../seqio";
import { buildLinearMapSvg } from "../seqmap";
import { buildCircularMapSvg } from "../seqmapcirc";
import { parseSnapGeneDna, looksLikeDna } from "../seqdna";
import { findSites, summarise, ENZYMES, isPalindromic, reverseComplementIupac, overhangOf } from "../enzymes";

// A deliberately nasty corpus of sequence files.
const HOSTILE_TEXT: string[] = [
  "",
  "   ",
  "\n\n\n",
  ">",
  ">justaheader",
  ">x\n",
  "LOCUS",
  "LOCUS x",
  "LOCUS x 0 bp DNA linear\nORIGIN\n//",
  "ORIGIN\n  1 acgt\n//",
  "//",
  "%PDF-1.4 \x00\x01binary",
  "\x00\x00\x00\x00",
  "ACGT".repeat(100000), // 400 kb of bare sequence
  ">x\n" + "N".repeat(50000),
  "LOCUS x 10 bp DNA circular\nFEATURES\n     CDS  join(\nORIGIN\n  1 acgtacgtac\n//",
  "LOCUS x 10 bp DNA circular\nFEATURES\n     CDS  complement(complement(1..5))\nORIGIN\n  1 acgtacgtac\n//",
  "💥🧬",
  "-".repeat(10000),
];

const GB_OK = `LOCUS       pT                       120 bp    DNA     circular SYN 15-JUL-2026
FEATURES             Location/Qualifiers
     promoter        1..40
                     /label="p"
     CDS             complement(41..80)
                     /gene="g"
ORIGIN
        1 ${"acgt".repeat(30)}
//
`;

const rec = (): SeqRecord => {
  const r = parseGenBank(GB_OK);
  if (!r.ok) throw new Error(r.error);
  return r.records[0];
};

describe("adversarial: nothing crashes, nothing hangs", () => {
  test("hostile text never throws in any reader", () => {
    for (const t of HOSTILE_TEXT) {
      expect(() => parseSequenceFile(t)).not.toThrow();
      expect(() => parseFasta(t)).not.toThrow();
      expect(() => parseGenBank(t)).not.toThrow();
    }
  });

  test("hostile bytes never throw in the .dna reader", () => {
    const cases = [
      new Uint8Array(0),
      new Uint8Array(1),
      new Uint8Array(5).fill(0xff),
      new Uint8Array(100000).fill(0x09),
      new Uint8Array([0x09, 0xff, 0xff, 0xff, 0xff, 0x01]),
      new Uint8Array([...Array(300).keys()].map((i) => i & 0xff)),
    ];
    for (const c of cases) {
      expect(() => parseSnapGeneDna(c)).not.toThrow();
      expect(() => looksLikeDna(c)).not.toThrow();
    }
  });

  test("hostile locations never throw", () => {
    const locs = [
      "",
      "(",
      ")",
      "join(",
      "join()",
      "complement(",
      "complement()",
      "join(complement(",
      "1..",
      "..1",
      "..",
      "^",
      "1^",
      "join(1..2,",
      "complement(join(complement(join(1..2))))",
      "9".repeat(400),
      "join(" + "1..2,".repeat(5000) + "1..2)",
    ];
    for (const l of locs) expect(() => parseLocation(l)).not.toThrow();
  });

  test("a huge file parses in reasonable time", () => {
    const t0 = Date.now();
    const r = parseFasta(">big\n" + "ACGT".repeat(50000)); // 200 kb
    expect(Date.now() - t0).toBeLessThan(4000);
    if (r.ok) expect(r.records[0].length).toBe(200000);
  });

  test("a deeply nested location terminates", () => {
    const deep = "complement(".repeat(200) + "1..5" + ")".repeat(200);
    const t0 = Date.now();
    expect(() => parseLocation(deep)).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test("maps never throw on a hostile record", () => {
    const base = rec();
    const nasty: SeqRecord[] = [
      { ...base, length: 0 },
      { ...base, length: 1 },
      { ...base, features: [] },
      { ...base, name: "" },
      { ...base, length: 1e9 },
      { ...base, features: base.features.map((f) => ({ ...f, start: -5, end: -1 })) },
      { ...base, features: base.features.map((f) => ({ ...f, start: 1e9, end: 2e9 })) },
      { ...base, features: base.features.map((f) => ({ ...f, name: "x".repeat(500) })) },
      { ...base, features: base.features.map((f) => ({ ...f, segments: [] })) },
    ];
    for (const r of nasty) {
      expect(() => buildLinearMapSvg(r)).not.toThrow();
      expect(() => buildCircularMapSvg(r)).not.toThrow();
    }
  });

  test("enzyme search never throws and stays fast on a large sequence", () => {
    const seq = "ACGTAGCTAGGATCCTAGCTNNNNRYKMSW".repeat(2000); // ~60 kb
    const t0 = Date.now();
    expect(() => findSites(seq)).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe("adversarial: no NaN, no negative, no off-canvas", () => {
  test("map SVGs never leak NaN/Infinity for any survivable record", () => {
    const base = rec();
    const cases: SeqRecord[] = [
      base,
      { ...base, circular: false },
      { ...base, length: 1, features: [] },
      { ...base, features: [{ ...base.features[0], start: 1, end: 1, segments: [{ start: 1, end: 1 }] }] },
    ];
    for (const r of cases) {
      for (const svg of [buildLinearMapSvg(r), buildCircularMapSvg(r)]) {
        if (!svg) continue;
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  test("every coordinate in a map is finite", () => {
    // The \s is load-bearing: without it this matches the "x" inside viewBox,
    // the "y" inside font-family and the "r" inside text-anchor, and reports
    // every map as broken. (It did, on the first run.)
    for (const svg of [buildLinearMapSvg(rec()), buildCircularMapSvg(rec())]) {
      for (const m of (svg as string).matchAll(/\s(?:x|y|x1|y1|x2|y2|cx|cy|r)="([^"]+)"/g)) {
        expect(Number.isFinite(Number(m[1]))).toBe(true);
      }
    }
  });

  test("a feature outside the sequence cannot push the drawing off-canvas", () => {
    const base = rec();
    const r: SeqRecord = {
      ...base,
      features: [{ ...base.features[0], start: 5000, end: 9000, segments: [{ start: 5000, end: 9000 }] }],
    };
    const svg = buildLinearMapSvg(r, { width: 400 });
    if (svg) {
      for (const m of svg.matchAll(/<path d="([^"]+)"/g)) {
        for (const p of m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) {
          expect(Number(p[1])).toBeGreaterThanOrEqual(-1);
          expect(Number(p[1])).toBeLessThanOrEqual(401);
        }
      }
    }
  });

  test("enzyme positions are always inside the sequence", () => {
    const seq = "GAATTCGGATCCAAGCTTGGTCTCAAAAGAGACC".repeat(20);
    for (const h of findSites(seq)) {
      expect(h.position).toBeGreaterThanOrEqual(1);
      expect(h.position).toBeLessThanOrEqual(seq.length);
      expect(Number.isInteger(h.position)).toBe(true);
      expect(h.cutPosition).toBeGreaterThanOrEqual(1);
    }
  });

  test("circular enzyme search never reports a position past the sequence", () => {
    const seq = "TTCAAAAAAAAAAAAAAAAAAGAA";
    for (const h of findSites(seq, { circular: true })) {
      expect(h.position).toBeGreaterThanOrEqual(1);
      expect(h.position).toBeLessThanOrEqual(seq.length);
    }
  });
});

describe("adversarial: biological invariants that must ALWAYS hold", () => {
  test("a parsed sequence contains only residue letters", () => {
    for (const t of [GB_OK, ">x\n  1 acg t\n 10 ACGT  "]) {
      const r = parseSequenceFile(t);
      if (!r.ok) continue;
      expect(r.records[0].sequence).toMatch(/^[A-Z*-]*$/);
      expect(r.records[0].sequence).not.toMatch(/\d|\s/);
    }
  });

  test("length always equals the sequence's actual length", () => {
    for (const t of [GB_OK, ">x\nACGTACGT", "ACGT"]) {
      const r = parseSequenceFile(t);
      if (!r.ok) continue;
      for (const rec of r.records) expect(rec.length).toBe(rec.sequence.length);
    }
  });

  test("a feature's span always covers its segments", () => {
    const r = parseGenBank(GB_OK);
    if (!r.ok) throw new Error("fixture");
    for (const f of r.records[0].features) {
      expect(f.start).toBe(Math.min(...f.segments.map((s) => s.start)));
      expect(f.end).toBe(Math.max(...f.segments.map((s) => s.end)));
      for (const s of f.segments) expect(s.start).toBeLessThanOrEqual(s.end);
    }
  });

  test("strand is only ever +1 or -1 — never 0, never undefined", () => {
    const r = parseGenBank(GB_OK);
    if (!r.ok) throw new Error("fixture");
    for (const f of r.records[0].features) expect([1, -1]).toContain(f.strand);
  });

  test("reverse complement is an involution for every enzyme site", () => {
    // rc(rc(x)) === x. If this fails anywhere, strand handling is unsound.
    for (const e of ENZYMES) {
      expect(reverseComplementIupac(reverseComplementIupac(e.site))).toBe(e.site);
    }
  });

  test("overhang length never exceeds the site length for a Type II enzyme", () => {
    for (const e of ENZYMES) {
      if (e.typeIIS) continue;
      const o = overhangOf(e);
      expect(o.length).toBeLessThanOrEqual(e.site.length);
    }
  });

  test("every enzyme's own site is found in a sequence containing it", () => {
    // The most basic invariant, swept over the whole table: plant each site and
    // confirm the engine finds it. A typo'd table entry fails here.
    for (const e of ENZYMES) {
      // Realise any ambiguity codes into a concrete sequence.
      const concrete = [...e.site].map((c) => ({ R: "A", Y: "C", S: "G", W: "A", K: "G", M: "A", B: "C", D: "A", H: "A", V: "A", N: "A" } as Record<string, string>)[c] ?? c).join("");
      const seq = "TTTTTTTTTT" + concrete + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const hits = findSites(seq, { only: [e.name] });
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.some((h) => h.position === 11)).toBe(true);
    }
  });

  test("a palindromic site is never reported twice", () => {
    // Searching both strands must not double-count. If it did, every palindromic
    // enzyme would look like a non-unique cutter and the ★ flag would be a lie.
    for (const e of ENZYMES) {
      if (!isPalindromic(e.site)) continue;
      if (/[NRYWSKMBDHV]/.test(e.site)) continue; // ambiguity can self-overlap
      const seq = "TTTTTTTTTT" + e.site + "AAAAAAAAAAAAAAAAAAAAAAAA";
      const hits = findSites(seq, { only: [e.name] });
      expect(hits).toHaveLength(1);
    }
  });
});

describe("adversarial: cross-module consistency", () => {
  test("what the parser reads is what the map draws", () => {
    const r = rec();
    const lin = buildLinearMapSvg(r)!;
    const circ = buildCircularMapSvg(r)!;
    for (const f of r.features) {
      expect(lin).toContain(f.name);
      expect(circ).toContain(f.name);
    }
  });

  test("a .dna record and a GenBank record produce the same shape of map", () => {
    // Both readers feed the same renderer; a shape mismatch would surface as a
    // crash or a blank map for one source only.
    const packet = (tag: number, data: string): number[] => {
      const b = [...data].map((c) => c.charCodeAt(0));
      const n = b.length;
      return [tag, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...b];
    };
    const bytes = new Uint8Array([
      ...packet(0x09, "SnapGene\x00\x01\x00\x0e\x00\x0e"),
      ...packet(0x00, String.fromCharCode(0x02) + "acgt".repeat(30)),
      ...packet(0x0a, '<Features><Feature name="p" type="promoter" directionality="1"><Segment range="1-40"/></Feature></Features>'),
    ]);
    const d = parseSnapGeneDna(bytes);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.record.length).toBe(120);
    expect(d.record.circular).toBe(true);
    const svg = buildCircularMapSvg(d.record);
    expect(svg).not.toBeNull();
    expect(svg!).toContain("p");
  });

  test("dna.ts's legacy API agrees with the new engine", async () => {
    const { restrictionSites, RESTRICTION_ENZYMES } = await import("../dna");
    const seq = "GAATTCGGATCCAAGCTT";
    const legacy = restrictionSites(seq);
    const modern = summarise(findSites(seq));
    expect(legacy.map((h) => h.enzyme).sort()).toEqual(modern.map((h) => h.enzyme).sort());
    // The legacy map must expose every enzyme the engine knows.
    expect(Object.keys(RESTRICTION_ENZYMES).length).toBe(ENZYMES.length);
  });

  test("summarise never loses or invents a hit", () => {
    const seq = "GAATTCAAAAGAATTCGGATCC";
    const hits = findSites(seq);
    const total = summarise(hits).reduce((n, s) => n + s.count, 0);
    expect(total).toBe(hits.length);
  });
});

describe("adversarial: honesty holds under pressure", () => {
  test("an unrecognised file always names the way out", () => {
    for (const t of ["%PDF-1.4", "{json:1}", "\x00\x01\x02", "random text here"]) {
      const r = parseSequenceFile(t);
      if (r.ok) continue;
      expect(r.error).toMatch(/FASTA|GenBank|empty/i);
    }
  });

  test("the .dna reader ALWAYS points at GenBank when it refuses", () => {
    // This is the whole safety net: the format understanding is unverified, so a
    // refusal must send the user somewhere that works.
    const junk = [
      new Uint8Array([...Array(50).keys()]),
      new Uint8Array([...">seq\nACGT"].map((c) => c.charCodeAt(0))),
      new Uint8Array([...'LOCUS x 10 bp DNA linear'].map((c) => c.charCodeAt(0))),
    ];
    for (const b of junk) {
      const r = parseSnapGeneDna(b);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/GenBank|too small/i);
    }
  });

  test("FASTA never claims a topology it cannot know", () => {
    // FASTA carries no topology. Guessing "circular" would be a claim about the
    // construct that the file does not support.
    const r = parseFasta(">plasmid circular vector\nACGT");
    if (r.ok) expect(r.records[0].circular).toBe(false);
  });

  test("FASTA never invents features", () => {
    const r = parseFasta(">x\nACGTACGT");
    if (r.ok) expect(r.records[0].features).toEqual([]);
  });

  test("a linear map discloses features crossing the origin", () => {
    const base = rec();
    const r: SeqRecord = {
      ...base,
      features: [{ ...base.features[0], name: "wrapper", wraps: true, start: 110, end: 130, segments: [{ start: 110, end: 130 }] }],
    };
    const svg = buildLinearMapSvg(r)!;
    expect(svg).toMatch(/cross the origin/);
    expect(svg).not.toContain("wrapper");
  });

  test("an unparseable location is dropped, never placed at a guess", () => {
    const bad = GB_OK.replace("promoter        1..40", "promoter        garbage!!!");
    const r = parseGenBank(bad);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.records[0].features.some((f) => f.type === "promoter")).toBe(false);
    expect(r.records[0].features.length).toBeGreaterThan(0); // the rest survived
  });

  test("a remote accession is never placed on THIS sequence", () => {
    // J00194.1:100..202 refers to a different record. Drawing it here would put
    // a feature at coordinates that mean nothing.
    const gb = GB_OK.replace("promoter        1..40", "promoter        J00194.1:100..202");
    const r = parseGenBank(gb);
    if (!r.ok) return;
    expect(r.records[0].features.some((f) => f.type === "promoter")).toBe(false);
  });

  test("N in a SEQUENCE is unknown, not a wildcard", () => {
    // If N matched anything, a sequence of Ns would "contain" every site and the
    // tool would confidently report sites that aren't known to exist.
    expect(findSites("N".repeat(200))).toEqual([]);
  });
});

describe("adversarial: the Type IIS strand bug cannot come back", () => {
  test("EVERY asymmetric enzyme finds its reverse-complement site", () => {
    const asym = ENZYMES.filter((e) => !isPalindromic(e.site));
    expect(asym.length).toBeGreaterThan(10);
    for (const e of asym) {
      const site = reverseComplementIupac(e.site);
      const concrete = [...site].map((c) => ({ R: "A", Y: "C", S: "G", W: "A", K: "G", M: "A", B: "C", D: "A", H: "A", V: "A", N: "A" } as Record<string, string>)[c] ?? c).join("");
      const seq = "TTTTTTTTTT" + concrete + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const hits = findSites(seq, { only: [e.name] });
      expect(hits.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("the Golden Gate enzymes find sites on both strands", () => {
    for (const [name, site] of [
      ["BsaI", "GGTCTC"],
      ["BsmBI", "CGTCTC"],
      ["BbsI", "GAAGAC"],
    ] as [string, string][]) {
      const fwd = findSites("AAAA" + site + "TTTT", { only: [name] });
      const rev = findSites("AAAA" + reverseComplementIupac(site) + "TTTT", { only: [name] });
      expect(fwd).toHaveLength(1);
      expect(fwd[0].strand).toBe(1);
      expect(rev).toHaveLength(1);
      expect(rev[0].strand).toBe(-1);
    }
  });
});
