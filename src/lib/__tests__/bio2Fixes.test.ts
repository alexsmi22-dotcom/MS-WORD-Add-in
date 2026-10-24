// Bio fix round 2: pinned regressions for confirmed defects in the SnapGene reader, the circular map,
// restriction-enzyme methylation, the true-minus helper, antibody numbering, the ST.26 builder and the aligner.
// Every expected value comes from an external oracle, quoted beside it.
//
// SnapGene fixtures (fixtures/snapgene/*.dna) are Biopython's own test files, Tests/SnapGene/ in
// github.com/biopython/biopython (Biopython License / BSD 3-Clause), read by Biopython 1.88 SnapGeneIO:
//   from Bio import SeqIO
//   rec = SeqIO.read("sample-f.dna", "snapgene")
//   for f in rec.features: print(f.type, f.qualifiers.get("label"), f.location, f.extract(rec.seq))
// sample-f.dna:
//   rep_origin ['FeatureA'] join{[160:180](+), [187:207](+), [214:241](+)}
//   primer_bind ['Primer 1'] [751:776](+) aaataaaaaacgattgaaggttaca
// sample-hybridization-params.dna:
//   primer_bind ['XhoI-hht2(US)-Fwd'] [497:516](+) CTCGAGGAAAAGCTTCAAC
//   primer_bind ['XmaI-hht2(Cter)-Rev'] [1396:1411](-) AGAACGCTCACCACG

import * as fs from "fs";
import * as path from "path";
import { parseSnapGeneDna } from "../seqdna";
import { buildCircularMapSvg } from "../seqmapcirc";
import { parseGenBank, type SeqRecord } from "../seqio";
import { ENZYMES, findSites, methylationWarnings } from "../enzymes";
import { trueMinus } from "../numberList";
import { CLONING_CALCS } from "../cloningCalcs";
import { numberChain } from "../antibody";
import { buildSt26Xml, featureNotes, featureWarnings, type SequenceEntry, type SequenceListingMeta } from "../sequence";
import { align, formatAlignment, NO_LOCAL_ALIGNMENT } from "../align";

const SNAP = path.join(__dirname, "fixtures", "snapgene");
const readDna = (name: string): SeqRecord => {
  const r = parseSnapGeneDna(new Uint8Array(fs.readFileSync(path.join(SNAP, name))));
  if (!r.ok) throw new Error(r.error);
  return r.record;
};
const revcomp = (s: string): string =>
  [...s.toUpperCase()].reverse().map((c) => ({ A: "T", T: "A", G: "C", C: "G" } as Record<string, string>)[c] ?? "N").join("");
/** The bases a feature covers on the strand it reads (1-based inclusive segments). */
const extract = (rec: SeqRecord, start: number, end: number, strand: 1 | -1): string => {
  const top = rec.sequence.slice(start - 1, end).toUpperCase();
  return strand === 1 ? top : revcomp(top);
};

// ---------------------------------------------------------------------------
// 1–2. Primer binding sites: +1 shift (Biopython _parse_location), strand from boundStrand.
// ---------------------------------------------------------------------------
describe("1–2. SnapGene primers", () => {
  test("sample-f Primer 1: location 751-775 anneals at 752..776, which IS its annealedBases", () => {
    const rec = readDna("sample-f.dna");
    const p = rec.features.find((f) => f.type === "primer_bind" && f.name === "Primer 1")!;
    expect([p.start, p.end, p.strand]).toEqual([752, 776, 1]);
    expect(extract(rec, p.start, p.end, p.strand)).toBe("aaataaaaaacgattgaaggttaca".toUpperCase());
  });

  test("hybridization-params: forward primer 497-515 → 498..516 = CTCGAGGAAAAGCTTCAAC", () => {
    const rec = readDna("sample-hybridization-params.dna");
    const p = rec.features.find((f) => f.name === "XhoI-hht2(US)-Fwd")!;
    expect([p.start, p.end, p.strand]).toEqual([498, 516, 1]);
    expect(extract(rec, p.start, p.end, p.strand)).toBe("CTCGAGGAAAAGCTTCAAC");
  });

  test('reverse primer boundStrand="1" is on the minus strand: 1397..1411, revcomp = annealedBases', () => {
    const rec = readDna("sample-hybridization-params.dna");
    const p = rec.features.find((f) => f.name === "XmaI-hht2(Cter)-Rev")!;
    expect([p.start, p.end, p.strand]).toEqual([1397, 1411, -1]);
    expect(extract(rec, p.start, p.end, p.strand)).toBe("AGAACGCTCACCACG");
  });
});

// ---------------------------------------------------------------------------
// 3–4. Feature labels and gap segments.
// ---------------------------------------------------------------------------
/** A minimal .dna: cookie, DNA packet, one Features packet (the framing seqdna.test.ts builds). */
function packet(tag: number, data: string): number[] {
  const bytes = [...new TextEncoder().encode(data)];
  const len = bytes.length;
  return [tag, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...bytes];
}
function dnaWithFeatures(featuresXml: string, seq = "acgt".repeat(250)): SeqRecord {
  const bytes = [
    ...packet(0x09, "SnapGene" + "\x00\x01\x00\x0e\x00\x0e"),
    ...packet(0x00, "\x02" + seq),
    ...packet(0x0a, `<?xml version="1.0"?><Features nextValidID="2">${featuresXml}</Features>`),
  ];
  const r = parseSnapGeneDna(new Uint8Array(bytes));
  if (!r.ok) throw new Error(r.error);
  return r.record;
}

describe("3. SnapGene feature labels", () => {
  test("pFA-KanMX4: the KanR CDS is labelled by its name, not its HTML product qualifier", () => {
    const rec = readDna("pFA-KanMX4.dna");
    const names = rec.features.map((f) => f.name);
    expect(names).toContain("KanR");
    expect(names.join("|")).not.toMatch(/[<>]|html|aminoglycoside/i);
    expect(names).toEqual(expect.arrayContaining(["TEF promoter", "TEF terminator", "AmpR promoter", "ori"]));
  });

  test("a nameless feature takes label/gene/product before note; HTML is stripped and entities decoded", () => {
    const rec = dnaWithFeatures(
      '<Feature type="CDS" directionality="1"><Segment range="10-99" type="standard"/>' +
        '<Q name="note"><V text="&lt;html&gt;&lt;body&gt;a note&lt;/body&gt;&lt;/html&gt;"/></Q>' +
        '<Q name="gene"><V text="&lt;html&gt;&lt;body&gt;&lt;i&gt;bla&lt;/i&gt; &amp;amp; co&lt;/body&gt;&lt;/html&gt;"/></Q>' +
        "</Feature>" +
        '<Feature type="misc_feature"><Segment range="200-220" type="standard"/>' +
        '<Q name="note"><V text="&lt;html&gt;&lt;body&gt;tail for &lt;b&gt;long&lt;/b&gt; primer&lt;/body&gt;&lt;/html&gt;"/></Q>' +
        "</Feature>",
    );
    expect(rec.features.map((f) => f.name)).toEqual(["bla & co", "tail for long primer"]);
  });
});

describe("4. SnapGene gap segments are skipped", () => {
  test("sample-f FeatureA → 161-180, 188-207, 215-241 (Biopython join{[160:180],[187:207],[214:241]})", () => {
    const rec = readDna("sample-f.dna");
    const a = rec.features.find((f) => f.name === "FeatureA")!;
    expect(a.segments.map((s) => [s.start, s.end])).toEqual([[161, 180], [188, 207], [215, 241]]);
    const b = rec.features.find((f) => f.name === "FeatureB")!;
    expect(b.segments.map((s) => [s.start, s.end])).toEqual([[400, 499], [517, 634], [635, 724]]);
    expect(b.strand).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 5. Circular map labels stay on the canvas.
// ---------------------------------------------------------------------------
describe("5. circular map labels are never clipped", () => {
  const W = 0.58; // scripts/figure-layout-audit.js ADVANCE
  const extent = (svg: string) => {
    const vb = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);
    const texts = [...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-family="[^"]*" font-size="([\d.]+)"[^>]*text-anchor="(start|end|middle)"[^>]*>([^<]*)<\/text>/g)];
    return { vb, texts };
  };
  function gb(features: string, len = 2686): string {
    return (
      `LOCUS       TESTMAP                 ${len} bp    DNA     circular SYN 01-JAN-2000\n` +
      "FEATURES             Location/Qualifiers\n" + features + `ORIGIN\n        1 ${"acgt".repeat(len / 2).slice(0, len)}\n//\n`
    );
  }
  test("a long right-side label (M77789's 'polylinker of M13mp19; HindIII-EcoRI…') and a crowded lower half fit", () => {
    const feats =
      '     misc_feature    396..454\n                     /note="polylinker of M13mp19; HindIII-EcoRI fragment of M13mp19 RF DNA"\n' +
      Array.from({ length: 14 }, (_, i) => `     misc_feature    ${1300 + i * 10}..${1305 + i * 10}\n                     /label="bottom feature number ${i}"\n`).join("");
    const p = parseGenBank(gb(feats));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const svg = buildCircularMapSvg(p.records[0])!;
    const { vb, texts } = extent(svg);
    const [x0, y0, w, h] = vb;
    for (const [, xs, ys, fs, anchor, t] of texts) {
      const x = Number(xs), y = Number(ys), tw = t.length * Number(fs) * W;
      const left = anchor === "start" ? x : anchor === "end" ? x - tw : x - tw / 2;
      expect({ t, inside: left >= x0 && left + tw <= x0 + w && y <= y0 + h && y - Number(fs) >= y0 }).toEqual({ t, inside: true });
    }
    // An over-long name is cut with an ellipsis, not drawn off the page.
    expect(svg).toContain("polylinker of M13mp19; HindIII-…");
    // The insert path reads both dimensions from the SVG: width/height match the viewBox.
    expect(svg).toMatch(new RegExp(`width="${w}" height="${h}" viewBox`));
  });
});

// ---------------------------------------------------------------------------
// 6. Dam / Dcm sensitivities from REBASE (rebase.neb.com/cgi-bin/msget?<enzyme>; MS# cited in enzymes.ts).
// ---------------------------------------------------------------------------
describe("6. REBASE Dam/Dcm sensitivities", () => {
  const meth = (n: string) => ENZYMES.find((e) => e.name === n)!.methylation;
  test.each([
    ["AlwI", { dam: "blocked" }],
    ["BspEI", { dam: "blocked-in-context" }],
    ["BsaBI", { dam: "blocked-in-context" }],
    ["MscI", { dcm: "blocked-in-context" }],
    ["PflMI", { dcm: "blocked-in-context" }],
    ["AlwNI", { dcm: "blocked-in-context" }],
    ["ApaI", { dcm: "blocked-in-context" }],
    ["Acc65I", { dcm: "blocked-in-context" }],
    ["KpnI", { dcm: "insensitive" }],
  ])("%s → %j", (name, want) => expect(meth(name)).toEqual(want));

  const warn = (seq: string, only: string[]) => methylationWarnings(seq, findSites(seq, { only }), false);
  test("Acc65I overlapping a Dcm site (GGTACCAGG) is warned; KpnI on the same DNA is not, and is suggested", () => {
    const w = warn("TTTTGGTACCAGGTTTT", ["Acc65I", "KpnI"]);
    expect(w.map((x) => [x.enzyme, x.methylase])).toEqual([["Acc65I", "dcm"]]);
    expect(w[0].message).toMatch(/KpnI/);
  });
  test("Acc65I without an overlapping CCWGG is not warned (context, not the enzyme)", () => {
    expect(warn("TTTTGGTACCTTTTT", ["Acc65I"])).toEqual([]);
  });
  test("AlwI is always Dam-blocked; BspEI only when TCCGGA runs into GATC", () => {
    expect(warn("TTTTGGATCTTTT", ["AlwI"]).map((x) => x.methylase)).toContain("dam");
    expect(warn("TTTTCCGGATCTT", ["BspEI"]).map((x) => x.enzyme)).toEqual(["BspEI"]);
    expect(warn("TTTTCCGGAATTT", ["BspEI"])).toEqual([]);
  });
  test("MscI overlapping CCWGG (TGGCCAGG) is Dcm-warned", () => {
    expect(warn("TTTTGGCCAGGTTT", ["MscI"]).map((x) => x.methylase)).toEqual(["dcm"]);
  });
});

// ---------------------------------------------------------------------------
// 7. trueMinus after a range dash, and in a quoted echo.
// ---------------------------------------------------------------------------
describe("7. trueMinus", () => {
  test.each([
    ["0–-5", "0–−5"],
    ["0—-5", "0—−5"],
    ["−1–-2", "−1–−2"],
    ['"-5" is not', '"-5" is not'], // a straight quote is markup syntax (dy="-5"): left alone
    ["“-5” is not", "“−5” is not"],
    ["0-based, 10-bit", "0-based, 10-bit"],
    ["a-5", "a-5"],
  ])("%s → %s", (a, b) => expect(trueMinus(a)).toBe(b));

  test("a cloning refusal echoing a negative position uses a true minus", () => {
    const pcr = CLONING_CALCS.find((c) => c.id === "cloning-pcr-primers")!;
    const vals: Record<string, string> = { template: "ATGC".repeat(50), start: "x", end: "-5", tm: "60", lmin: "18", lmax: "30" };
    const r = pcr.compute((k) => vals[k] ?? "");
    expect(r.ok).toBe(false);
    expect(r.text).toContain("“x” to “−5”");
    expect(r.text).not.toMatch(/-\d/);
  });
});

// ---------------------------------------------------------------------------
// 8. λ IGLV6 framework-3 insertions, against ANARCI.
//
// Oracle: ANARCI 2026.2.13.2 (venv jurislab-oracle-venv), hmmscan supplied by pyhmmer 0.12.3 because HMMER has no
// Windows build. The shim hands ANARCI's own _parse_hmmer_query what Biopython's hmmer3-text parser would:
//   def run_hmmer(sequence_list, hmm_database="ALL", hmmerpath="", ncpu=None, bit_score_threshold=80, hmmer_species=None):
//       hmms = list(pyhmmer.plan7.HMMFile(os.path.join(A.HMM_path, "ALL.hmm")))
//       for seq, hits in zip(seqs, pyhmmer.hmmscan(seqs, hmms)):   # seqs: digitized amino TextSequences
//           for each reported hit / reported domain d (al = d.alignment):
//               hsp: hit_id = hit.name, evalue = d.i_evalue, bitscore = d.score, bias = d.bias,
//                    query_start = al.target_from - 1, query_end = al.target_to,
//                    hit_start = al.hmm_from - 1, hit_end = al.hmm_to,
//                    aln_annotation = {"RF": "".join("." if c == "." else "x" for c in al.hmm_sequence),
//                                      "PP": al.posterior_probabilities}
//           results.append(A._parse_hmmer_query(q, ...))     # q.hsps, q.seq_len
//   A.run_hmmer = run_hmmer; A.anarci([("q", V6)], scheme=s, output=False)  for s in kabat, chothia, imgt
// Sanity check of the shim: a VH3 control numbers 52A, 82A–C, 100A–D as textbook Kabat.
// (AntPack, cited by an earlier round, puts the Kabat insertion at 65A/65B; the task directs ANARCI.)
// ---------------------------------------------------------------------------
describe("8. IGLV6-57 framework-3 insertion per scheme (ANARCI)", () => {
  const V6 = "NFMLTQPHSVSESPGKTVTISCTRSSGSIASNYVQWYQQRPGSSPTTVIYEDNQRPSGVPDRFSGSIDSSSNSASLTISGLKTEDEADYYCQSYDSSNVVFGGGTKLTVL";
  const r = numberChain(V6);
  const seq = (s: string) => s.split(" ");
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  const KABAT = seq(
    "1 2 3 4 5 6 7 8 9 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 27A 27B 28 29 30 31 32 33 34 35 36 37 38 39 40 " +
      "41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 66A 66B " + range(67, 107).join(" "),
  );
  const CHOTHIA = seq(
    "1 2 3 4 5 6 7 8 9 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 30A 30B 31 32 33 34 35 36 37 38 39 40 " +
      range(41, 68).join(" ") + " 68A 68B " + range(69, 107).join(" "),
  );
  const IMGT = seq(
    "1 2 3 4 5 6 7 8 9 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 35 36 37 38 39 40 41 42 43 44 45 46 47 " +
      "48 49 50 51 52 53 54 55 56 57 65 66 67 68 69 70 71 72 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 " +
      "95 96 97 98 99 100 101 102 103 104 105 106 107 108 109 114 115 116 117 118 119 120 121 122 123 124 125 126 127",
  );
  test("Kabat, Chothia and IMGT label every residue exactly as ANARCI does", () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.numbering.kabat).toEqual(KABAT);
    expect(r.numbering.chothia).toEqual(CHOTHIA);
    expect(r.numbering.imgt).toEqual(IMGT);
  });
  test("the inserted residues: Kabat 66 I, 66A D, 66B S; Chothia 68 S, 68A S, 68B S", () => {
    if (!r.ok) throw new Error("not numbered");
    const at = (labels: string[], p: string) => r.domain[labels.indexOf(p)];
    expect(["66", "66A", "66B", "67"].map((p) => at(r.numbering.kabat, p)).join("")).toBe("IDSS");
    expect(["67", "68", "68A", "68B", "69"].map((p) => at(r.numbering.chothia, p)).join("")).toBe("DSSSN");
  });
});

// ---------------------------------------------------------------------------
// Minor items.
// ---------------------------------------------------------------------------
describe("minor: buildSt26Xml refuses rather than emit DTD-invalid XML", () => {
  const META: SequenceListingMeta = { applicantName: "A", inventionTitle: "B", applicantFileReference: "R1", productionDate: "2026-10-24" };
  test("every entry below the ST.26 minimum → named refusal (the DTD needs SequenceData+)", () => {
    expect(() => buildSt26Xml(META, [{ moltype: "DNA", residues: "acgt" }])).toThrow(/every sequence is below the ST\.26 minimum/);
  });
  test("no entries → named refusal", () => {
    expect(() => buildSt26Xml(META, [])).toThrow(/no sequences/);
  });
  test("no file reference and no application identification → named refusal", () => {
    const { applicantFileReference: _drop, ...noRef } = META;
    void _drop;
    expect(() => buildSt26Xml(noRef, [{ moltype: "DNA", residues: "acgtacgtac" }])).toThrow(/file reference/);
  });
  test("a valid listing still builds", () => {
    expect(buildSt26Xml(META, [{ moltype: "DNA", residues: "acgtacgtac" }])).toContain("<SequenceTotalQuantity>1</SequenceTotalQuantity>");
  });
});

describe("minor: an unusable /codon_start never sits beside a frame-1 /translation", () => {
  const META: SequenceListingMeta = { applicantName: "A", inventionTitle: "B", applicantFileReference: "R1", productionDate: "2026-10-24" };
  const entry = (cs: string): SequenceEntry => ({
    moltype: "DNA",
    residues: "ATGGCATGCATGCACTAA",
    features: [{ key: "CDS", location: "1..18", qualifiers: [{ name: "codon_start", value: cs }] }],
  });
  test.each(["4", "two", "2a", "0"])("/codon_start %s → no /translation, and a warning saying why", (cs) => {
    const xml = buildSt26Xml(META, [entry(cs)]);
    expect(xml).not.toContain(">translation<");
    expect(featureWarnings(entry(cs)).join(" ")).toMatch(/no \/translation was generated — \/codon_start “.+” is not 1, 2 or 3/);
    expect(featureNotes(entry(cs)).join(" ")).not.toMatch(/translation generated/);
  });
  test("/codon_start 2 translates from base 2 (unchanged)", () => {
    const xml = buildSt26Xml(META, [{ ...entry("2"), residues: "AATGGCATGCATGCACTAA", features: [{ key: "CDS", location: "1..19", qualifiers: [{ name: "codon_start", value: "2" }] }] }]);
    expect(xml).toMatch(/<INSDQualifier_value>MACMH<\/INSDQualifier_value>/);
  });
});

describe("minor: a local alignment with no positive segment says so", () => {
  test("no shared residue at all → the named sentence, not 'Length 0'", () => {
    const r = align("AAAAAAAAAA", "CCCCCCCCCC", { mode: "local", kind: "dna" })!;
    expect(r.length).toBe(0);
    expect(r.noAlignment).toBe(NO_LOCAL_ALIGNMENT);
    expect(r.caveats[0]).toBe(NO_LOCAL_ALIGNMENT);
    expect(formatAlignment(r)).toBe(NO_LOCAL_ALIGNMENT);
  });
  test("a real local alignment carries no such flag", () => {
    const r = align("TTTTACGTACGTTTTT", "GGGACGTACGGG", { mode: "local", kind: "dna" })!;
    expect(r.length).toBeGreaterThan(0);
    expect(r.noAlignment).toBeUndefined();
  });
});

describe("minor: a VH cut off inside framework 3 is told so", () => {
  // Trastuzumab VH (fixtures/antibody-numbering.json) cut inside FR3.
  const H = "EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS";
  test.each([70, 80, 90])("cut at %i residues → 'ends inside framework 3', not 'not an antibody' / a light-chain message", (cut) => {
    const r = numberChain(H.slice(0, cut));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/ends inside framework 3/);
    expect(r.errors.join(" ")).not.toMatch(/light-chain|does not read as an antibody/);
  });
});
