// THE FIXED CASE TABLE for Molecular cloning (Release C, gap #13).
//
// Every row is input → a value or a NAMED refusal. Reviewers probe against this
// file and add to it; every later fix round must keep every earlier row's
// outcome. A row that disagrees with the written convention is a bug in the row
// OR in the code — it is never silently dropped.
//
// ORACLES, all external to this code:
//   * Ladder band lists: the manufacturers' own pages/manual, quoted in gel.ts
//     with the URL and the fetch date (2026-10-22). Pinned here byte-for-byte,
//     so a later edit to the table fails this file rather than the bench.
//   * pUC19: NCBI L09137.2 (2,686 bp), in __tests__/fixtures/puc19.ts. EcoRI
//     cuts pUC19 exactly once — the textbook fact — so a circular EcoRI digest
//     is one 2,686 bp band.
//   * Tm: dna.ts primerTm, the app's only Tm. The rows assert that the number a
//     cloning tool prints IS primerTm of that exact oligo, not a second model.

import {
  LADDERS,
  buildGel,
  customLadder,
  laneFromDigest,
  ladderById,
  migrationPos,
  type Ladder,
} from "../gel";
import { gelSvg } from "../gelChart";
import { primerMapSvg } from "../cloningCharts";
import { goldenGate, gibson, pcrPrimers, readParts, threePrimeComplement } from "../cloning";
import { CLONING_CALCS } from "../cloningCalcs";
import { primerTm, reverseComplement } from "../dna";
import { PUC19, PUC19_LENGTH } from "./fixtures/puc19";

const calc = (id: string) => {
  const c = CLONING_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
};
const run = (id: string, over: Record<string, string> = {}) => {
  const c = calc(id);
  const vals: Record<string, string> = {};
  for (const f of c.fields) vals[f.key] = f.default;
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
};

const NEB_1KB = ladderById("neb-1kb") as Ladder;
const NEB_100BP = ladderById("neb-100bp") as Ladder;
const NEB_PLUS = ladderById("neb-1kb-plus") as Ladder;
const GENERULER = ladderById("generuler-1kb") as Ladder;

// --------------------------------------------------------------- the ladders

describe("ladders are the fetched manufacturer data, byte for byte", () => {
  test("NEB 1 kb DNA Ladder N3232 (neb.com, fetched 2026-10-22)", () => {
    expect(NEB_1KB.bands.map((b) => b.sizes)).toEqual([
      [10002], [8001], [6001], [5001], [4001], [3001], [2000], [1500], [1000], [517], [500],
    ]);
    expect(NEB_1KB.bands.map((b) => b.massNg)).toEqual([42, 42, 50, 42, 33, 125, 48, 36, 42, 21, 21]);
    // The page names exactly one reference band for this ladder.
    expect(NEB_1KB.bands.filter((b) => b.reference).map((b) => b.sizes[0])).toEqual([3001]);
  });

  test("NEB 100 bp DNA Ladder N3231", () => {
    expect(NEB_100BP.bands.map((b) => b.sizes)).toEqual([
      [1517], [1200], [1000], [900], [800], [700], [600], [517, 500], [400], [300], [200], [100],
    ]);
    expect(NEB_100BP.bands.map((b) => b.massNg)).toEqual([45, 35, 95, 27, 24, 21, 18, 97, 38, 29, 25, 48]);
    expect(NEB_100BP.bands.filter((b) => b.reference).map((b) => b.label)).toEqual(["1,000", "500/517"]);
  });

  test("NEB 1 kb Plus DNA Ladder N3200 (19 bands)", () => {
    expect(NEB_PLUS.bands.map((b) => b.sizes)).toEqual([
      [10002], [8001], [6001], [5001], [4001], [3001], [2017], [1517], [1200], [1000],
      [900], [800], [700], [600], [517, 500], [400], [300], [200], [100],
    ]);
    expect(NEB_PLUS.bands.map((b) => b.massNg)).toEqual([
      40, 40, 48, 40, 32, 120, 40, 57, 45, 122, 34, 31, 27, 23, 124, 49, 37, 32, 61,
    ]);
    expect(NEB_PLUS.bands).toHaveLength(19);
  });

  test("Thermo GeneRuler 1 kb SM0311 (14 fragments, no published masses)", () => {
    expect(GENERULER.bands.map((b) => b.sizes[0])).toEqual([
      10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500, 250,
    ]);
    expect(GENERULER.bands.every((b) => b.massNg === null)).toBe(true);
    expect(GENERULER.bands.filter((b) => b.reference).map((b) => b.sizes[0])).toEqual([6000, 3000, 1000]);
  });

  test("every shipped ladder carries its source and fetch date", () => {
    for (const l of LADDERS) {
      expect(l.source).toMatch(/neb\.com|thermofisher/);
      expect(l.fetched).toBe("2026-10-22");
      expect(l.bands.length).toBeGreaterThan(5);
    }
  });

  test("a custom ladder needs at least two sizes, and sorts them", () => {
    expect(customLadder([500])).toEqual({ error: expect.stringContaining("at least two") });
    const made = customLadder([1000, 5000, 2000]);
    if ("error" in made) throw new Error(made.error);
    expect(made.bands.map((b) => b.sizes[0])).toEqual([5000, 2000, 1000]);
  });
});

// ------------------------------------------------------------ gel migration

describe("gel migration: interpolated between the ladder's own bands", () => {
  test("a 3,001 bp band sits exactly on the NEB 1 kb ladder's 3,001 band", () => {
    const band = migrationPos(3001, NEB_1KB);
    const ladderBand = NEB_1KB.bands.find((b) => b.sizes[0] === 3001)!;
    expect(band.offScale).toBeNull();
    expect(band.pos).toBeCloseTo(migrationPos(ladderBand.sizes[0], NEB_1KB).pos, 12);
  });

  test("1,500 lies between the 1,000 and 2,000 ladder bands", () => {
    const p1500 = migrationPos(1500, NEB_1KB).pos;
    expect(p1500).toBeGreaterThan(migrationPos(2000, NEB_1KB).pos);
    expect(p1500).toBeLessThan(migrationPos(1000, NEB_1KB).pos);
  });

  test("20 kb with the 1 kb ladder is drawn at the edge and SAYS SO", () => {
    expect(migrationPos(20000, NEB_1KB)).toEqual({ pos: 0, offScale: "above" });
    const out = run("cloning-gel", { lanes: "Big: 20000" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/above the largest ladder band/);
    expect(out.text).toMatch(/not to scale/);
  });

  test("below the smallest ladder band is the mirror case", () => {
    expect(migrationPos(60, NEB_1KB)).toEqual({ pos: 1, offScale: "below" });
    const out = run("cloning-gel", { lanes: "Tiny: 60" });
    expect(out.text).toMatch(/below the smallest ladder band/);
  });

  test("positions are monotone in size over the whole ladder range", () => {
    let prev = -1;
    for (let s = 10002; s >= 500; s -= 7) {
      const p = migrationPos(s, NEB_1KB).pos;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  test("co-migrating fragments merge, with a named note (digest.ts's rule)", () => {
    const out = run("cloning-gel", { lanes: "Digest: 4001, 3800, 700" });
    expect(out.text).toMatch(/4001 and 3800 bp are within ~8 % of each other and are drawn as ONE band/);
  });
});

// ------------------------------------------------------------------- pUC19

describe("pUC19 (NCBI L09137.2)", () => {
  test("the fixture is the 2,686 bp plasmid", () => {
    expect(PUC19).toHaveLength(PUC19_LENGTH);
    expect(PUC19_LENGTH).toBe(2686);
  });

  test("EcoRI alone, circular, gives ONE 2,686 bp fragment", () => {
    const lane = laneFromDigest("pUC19", PUC19, ["EcoRI"], true);
    if ("error" in lane) throw new Error(lane.error);
    expect(lane.sizes).toEqual([2686]);
  });

  test("EcoRI on the LINEAR molecule gives two fragments that sum to 2,686", () => {
    const lane = laneFromDigest("pUC19", PUC19, ["EcoRI"], false);
    if ("error" in lane) throw new Error(lane.error);
    expect(lane.sizes).toHaveLength(2);
    expect(lane.sizes.reduce((a, b) => a + b, 0)).toBe(2686);
  });

  test("the gel tool draws that digest as one band and says the plasmid is circular", () => {
    const out = run("cloning-gel", { lanes: "", seq: PUC19, enzymes: "EcoRI", topology: "circular" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/2,686 bp|2686 bp/);
    expect(out.text).toMatch(/supercoiled/);
  });

  test("an enzyme that is not in the table is named, not silently dropped", () => {
    const lane = laneFromDigest("pUC19", PUC19, ["NotAnEnzyme"], true);
    expect(lane).toEqual({ error: expect.stringContaining("none of those enzymes are in the table") });
  });
});

// ------------------------------------------------------------- Golden Gate

const GG_PARTS = [
  "promoter: AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGGCTCGTATAATGTGTGGA",
  "cds: GGTTCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGG",
  "terminator: GCTTACTCGAGCAAAGGCCCAGTCTTTCGACTGAGCCTTTCGTTTTATTTGATGCCTGGCAGTTCCCTACT",
].join("\n");

describe("Golden Gate", () => {
  test("three good parts: assembled length is the sum of the parts", () => {
    const parts = readParts(GG_PARTS, "Parts");
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    if (!r.ok) throw new Error(r.error);
    const sum = parts.parts.reduce((s, p) => s + p.seq.length, 0);
    expect(r.productLength).toBe(sum);
    expect(r.overhangs.map((o) => o.seq)).toEqual(["AATG", "GGTT", "GCTT"]);
    expect(r.primers).toHaveLength(6);
  });

  test("a BsaI site inside a part is refused, naming the part, the position and the strand", () => {
    const parts = readParts(
      "insert: GGTCTCAAATGGCTAGCAAGGCTTTACACTTTATGCTTCCGGCTCGTATAATGTGTGGA\nother: CATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGC",
      "Parts",
    );
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/“insert” contains 1 internal BsaI site \(GGTCTC\) at position 1 on the forward strand/);
  });

  test("a reverse-strand internal site is caught too (both strands are searched)", () => {
    const rc = reverseComplement("GGTCTC");
    const parts = readParts(
      `insert: AATGGCTAGCAAGG${rc}CTTTACACTTTATGCTTCCGGCTCGTATAATGTGTGGA\nother: CATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGC`,
      "Parts",
    );
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/reverse strand/);
  });

  test("AATG and CATT are reverse complements: refused, naming the pair", () => {
    const parts = readParts(
      "a: AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG\nb: CATTGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG",
      "Parts",
    );
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/“a” \(AATG\) and “b” \(CATT\) are reverse complements/);
  });

  test("a palindromic overhang GATC is refused by name", () => {
    const parts = readParts(
      "a: GATCGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG\nb: TTTGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG",
      "Parts",
    );
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/“a” is GATC, which is its own reverse complement \(palindromic\)/);
  });

  test("two identical fusion sites are refused by name", () => {
    const parts = readParts(
      "a: AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG\nb: AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCGGG",
      "Parts",
    );
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/the SAME fusion site \(AATG\)/);
  });

  test("overhangs differing at one base are a WARNING citing Potapov 2018, not a refusal", () => {
    const parts = readParts(
      "a: AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG\nb: AGTGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCGGG",
      "Parts",
    );
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings.join(" ")).toMatch(/differ at only one base/);
    expect(r.warnings.join(" ")).toMatch(/acssynbio\.8b00333/);
  });

  test("the spacer and overhang lengths come from the enzyme table, per enzyme", () => {
    const parts = readParts(GG_PARTS, "Parts");
    if ("ok" in parts) throw new Error(parts.error);
    const bsa = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    const sap = goldenGate({ parts: parts.parts, enzyme: "SapI" });
    if (!bsa.ok) throw new Error(bsa.error);
    if (!sap.ok) throw new Error(sap.error);
    // BsaI GGTCTC(1/5): 1 nt spacer, 4 nt overhang. SapI GCTCTTC(1/4): 1 and 3.
    expect([bsa.spacerLength, bsa.overhangLength]).toEqual([1, 4]);
    expect([sap.spacerLength, sap.overhangLength]).toEqual([1, 3]);
    expect(sap.overhangs.every((o) => o.seq.length === 3)).toBe(true);
  });

  test("a non-Type-IIS enzyme is refused with the reason", () => {
    const parts = readParts(GG_PARTS, "Parts");
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "EcoRI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/EcoRI is not a Type IIS enzyme/);
  });

  test("every primer's quoted Tm IS primerTm of its annealing part (one Tm in the app)", () => {
    const parts = readParts(GG_PARTS, "Parts");
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI" });
    if (!r.ok) throw new Error(r.error);
    for (const p of r.primers) {
      expect(p.tm.tm).toBe(primerTm(p.anneal).tm);
      expect(p.seq).toBe(p.tail + p.anneal);
      expect(p.seq.startsWith("GGTCTC")).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ Gibson

const GIBSON_FRAGS = [
  "vector: GGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGATTTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTT",
  "insert: ATGAGCAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGGTCATAAATTTTCT",
].join("\n");

describe("Gibson / HiFi", () => {
  test("each junction's overlap Tm equals primerTm of that overlap", () => {
    const frags = readParts(GIBSON_FRAGS, "Fragments");
    if ("ok" in frags) throw new Error(frags.error);
    const r = gibson({ fragments: frags.parts, circular: true, mode: "length", overlapLength: 20 });
    if (!r.ok) throw new Error(r.error);
    expect(r.junctions).toHaveLength(2);
    for (const j of r.junctions) {
      expect(j.length).toBe(20);
      expect(j.tm.tm).toBe(primerTm(j.overlap).tm);
      // The convention: the overlap is the downstream fragment's own 5' end.
      const down = frags.parts.find((f) => f.name === j.downstream)!;
      expect(down.seq.startsWith(j.overlap)).toBe(true);
    }
  });

  test("a linear assembly has one junction fewer than a circular one", () => {
    const frags = readParts(GIBSON_FRAGS, "Fragments");
    if ("ok" in frags) throw new Error(frags.error);
    const lin = gibson({ fragments: frags.parts, circular: false, mode: "length", overlapLength: 20 });
    if (!lin.ok) throw new Error(lin.error);
    expect(lin.junctions).toHaveLength(1);
    expect(lin.productLength).toBe(frags.parts.reduce((s, f) => s + f.seq.length, 0));
  });

  test("Tm mode picks the SHORTEST overlap that reaches the target", () => {
    const frags = readParts(GIBSON_FRAGS, "Fragments");
    if ("ok" in frags) throw new Error(frags.error);
    const r = gibson({ fragments: frags.parts, circular: true, mode: "tm", targetOverlapTm: 50 });
    if (!r.ok) throw new Error(r.error);
    for (const j of r.junctions) {
      const down = frags.parts.find((f) => f.name === j.downstream)!;
      expect(primerTm(j.overlap).tm).toBeGreaterThanOrEqual(50);
      if (j.length > 15) {
        expect(primerTm(down.seq.slice(0, j.length - 1)).tm).toBeLessThan(50);
      }
    }
  });

  test("an overlap outside NEB's published range is a named warning that cites the source", () => {
    const frags = readParts(GIBSON_FRAGS, "Fragments");
    if ("ok" in frags) throw new Error(frags.error);
    const r = gibson({ fragments: frags.parts, circular: true, mode: "length", overlapLength: 35 });
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings.join(" ")).toMatch(/outside NEB's published range/);
    expect(r.warnings.join(" ")).toMatch(/fetched 2026-10-22/);
  });

  test("an overlap length outside 15–40 nt is refused", () => {
    const frags = readParts(GIBSON_FRAGS, "Fragments");
    if ("ok" in frags) throw new Error(frags.error);
    const r = gibson({ fragments: frags.parts, circular: true, mode: "length", overlapLength: 8 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/outside the 15–40 nt this tool designs/);
  });
});

// -------------------------------------------------------------- PCR primers

const TEMPLATE = (CLONING_CALCS.find((c) => c.id === "cloning-pcr-primers")!.fields.find((f) => f.key === "template")!.default);

describe("PCR primer design", () => {
  test("a 1 kb region returns primers within the documented tolerance of the target", () => {
    // A 1 kb template of real-looking sequence, built from the shipped default.
    const template = (TEMPLATE + TEMPLATE + TEMPLATE).slice(0, 1000);
    const r = pcrPrimers({ template, start: 1, end: 1000, targetTm: 60 });
    if (!r.ok) throw new Error(r.error);
    expect(Math.abs(r.forward.tm.tm - 60)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.reverse.tm.tm - 60)).toBeLessThanOrEqual(3);
    expect(r.ampliconLength).toBe(1000);
    expect(r.forward.anneal.length).toBeGreaterThanOrEqual(18);
    expect(r.forward.anneal.length).toBeLessThanOrEqual(30);
    // The primers are the template's own ends.
    expect(template.startsWith(r.forward.anneal)).toBe(true);
    expect(template.endsWith(reverseComplement(r.reverse.anneal))).toBe(true);
    // One Tm in the app.
    expect(r.forward.tm.tm).toBe(primerTm(r.forward.anneal).tm);
    expect(r.reverse.tm.tm).toBe(primerTm(r.reverse.anneal).tm);
  });

  test("a region outside the template is refused, naming the template's range", () => {
    const r = pcrPrimers({ template: TEMPLATE, start: 1, end: 99999 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/is not inside this template, which is 1–336/);
  });

  test("a region shorter than two primers is refused rather than designed", () => {
    const r = pcrPrimers({ template: TEMPLATE, start: 10, end: 40 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/shorter than two 18 nt primers/);
  });

  test("an empty template is cleanDna's refusal, through the calculator", () => {
    const out = run("cloning-pcr-primers", { template: "" });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/No DNA bases were found in the template/);
  });

  test("3′ complementarity is exact arithmetic, and is reported", () => {
    // A primer whose 3' end is the reverse complement of its own 5' end.
    expect(threePrimeComplement("GGGGAAAAAAAAAACCCC", "GGGGAAAAAAAAAACCCC")).toBe(4);
    expect(threePrimeComplement("ACGTACGTACGTACGTAA", "TTTTTTTTTTTTTTTTTT")).toBe(0);
  });

  test("ΔTm between the primers is reported and warned about past 3 °C", () => {
    const r = pcrPrimers({ template: TEMPLATE, start: 1, end: 336, targetTm: 60 });
    if (!r.ok) throw new Error(r.error);
    expect(r.deltaTm).toBeCloseTo(Math.abs(r.forward.tm.tm - r.reverse.tm.tm), 10);
    if (r.deltaTm > 3) expect(r.warnings.join(" ")).toMatch(/differ by/);
  });
});

// ------------------------------------------------------- adversarial inputs

describe("adversarial input", () => {
  test("lowercase, whitespace and digits are cleaned by cleanDna", () => {
    const parts = readParts("a: aatg gtcagtcc 10 taggtataatgctagcaaggctttacactttatgcttccgg", "Parts");
    if ("ok" in parts) throw new Error(parts.error);
    expect(parts.parts[0].seq).toBe("AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG");
  });

  test("a FASTA header is a part name, and its letters never enter the sequence", () => {
    const parts = readParts(
      ">pACYC_insert cloning vector\nAATGGTCAGTCCTAGGTATAATGCTAGCAAGG\nCTTTACACTTTATGCTTCCGG\n>second\nGGTTCTAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCG",
      "Parts",
    );
    if ("ok" in parts) throw new Error(parts.error);
    expect(parts.parts.map((p) => p.name)).toEqual(["pACYC_insert", "second"]);
    expect(parts.parts[0].seq).toBe("AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG");
  });

  test("RNA (U) and IUPAC N are refused by name, not silently resolved", () => {
    const rna = readParts("a: AAUGGUCAGUCCUAGGUAUAAUGCUAGCAAGGCUUUACACUUUAUGCUUCCGG", "Parts");
    expect(rna).toEqual({ ok: false, error: expect.stringContaining("contains U") });
    const n = readParts("a: AATGGTCAGTCCTAGGTNTAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG", "Parts");
    expect(n).toEqual({ ok: false, error: expect.stringContaining("contains N") });
  });

  test("a part with no bases at all is refused by name", () => {
    expect(readParts("a: ????", "Parts")).toEqual({ ok: false, error: expect.stringContaining("has no DNA bases") });
    expect(readParts("", "Parts")).toEqual({ ok: false, error: "Parts: nothing to read." });
  });

  test("more than 20 parts is refused", () => {
    const many = Array.from({ length: 21 }, (_, i) => `p${i}: AATGGTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTTATGCTTCCGG`).join("\n");
    expect(readParts(many, "Parts")).toEqual({ ok: false, error: expect.stringContaining("capped at 20") });
  });

  test("more than 14 sample lanes is refused by name", () => {
    const lanes = Array.from({ length: 15 }, (_, i) => `L${i}: 1000`).join("\n");
    const out = run("cloning-gel", { lanes });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/up to 14/);
  });

  test("decimal-comma sizes go through the one number reader (dataBlock N1-N3)", () => {
    // "3,000 1500" — a comma number beside a plain one: dataBlock decides, not us.
    const out = run("cloning-gel", { lanes: "A: 3000 1500\nB: 850" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/3,000 bp/);
  });

  test("a lane line with no numbers is refused, not drawn empty", () => {
    const out = run("cloning-gel", { lanes: "Digest A: none yet\nB: 1000" });
    expect(out.ok).toBe(false);
  });

  test("a huge template stays well inside the freeze budget", () => {
    const big = TEMPLATE.repeat(300).slice(0, 100_000);
    const t0 = Date.now();
    const r = pcrPrimers({ template: big, start: 1, end: 100_000, targetTm: 60 });
    const dt = Date.now() - t0;
    expect(r.ok).toBe(true);
    expect(dt).toBeLessThan(300);
  });

  test("a sequence past 100 kb is refused rather than run", () => {
    const tooBig = "ACGT".repeat(26_000);
    const r = pcrPrimers({ template: tooBig, start: 1, end: 1000 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/past the 100,000/);
  });

  test("a 14-lane gel with a 100 kb digest lane draws inside the budget", () => {
    const seq = PUC19.repeat(37).slice(0, 99_000);
    const t0 = Date.now();
    const out = run("cloning-gel", { lanes: "A: 1000", seq, enzymes: "EcoRI", topology: "linear" });
    const dt = Date.now() - t0;
    expect(out.ok).not.toBe(false);
    expect(dt).toBeLessThan(3000);
  });
});

// ------------------------------------- gel drawing (integrator review, round 1)

/** Band and well rectangles of a gel SVG, grouped by lane (their x). */
function gelRects(svg: string): { bands: Map<number, { y: number; h: number }[]>; wells: Map<number, { y: number; h: number }> } {
  const bands = new Map<number, { y: number; h: number }[]>();
  const wells = new Map<number, { y: number; h: number }>();
  const re = /<rect class="(band|well)" x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const kind = m[1];
    const x = Number(m[2]);
    const r = { y: Number(m[3]), h: Number(m[4]) };
    // A band is inset 2 px in its lane, a well 3 px: key both by the lane's left edge.
    const lane = Math.round(x - (kind === "band" ? 2 : 3));
    if (kind === "well") wells.set(lane, r);
    else bands.set(lane, [...(bands.get(lane) ?? []), r]);
  }
  return { bands, wells };
}

const STRESS_LANES = [
  { name: "Doublet", sizes: [517, 500] },
  { name: "Edge pile-up", sizes: [50000, 30000, 20000, 15] },
  { name: "Tight", sizes: [1000, 960, 920, 880, 840, 800] },
  { name: "Spread", sizes: [10002, 3001, 1000, 100] },
  { name: "Every ladder size", sizes: [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2017, 2000, 1517, 1500, 1200, 1000, 900, 800, 750, 700, 600, 517, 500, 400, 300, 250, 200, 100] },
];

describe("gel drawing: wells, doublets, lane names", () => {
  const wide = customLadder([50000, 100]);
  const allLadders: Ladder[] = [...LADDERS, ...("error" in wide ? [] : [wide])];

  test.each(allLadders.map((l) => [l.id, l] as const))("%s: no two band rectangles in one lane overlap", (_id, ladder) => {
    for (const style of ["dark-on-light", "ethidium"] as const) {
      const model = buildGel({ ladder, lanes: STRESS_LANES, style });
      if ("error" in model) throw new Error(model.error);
      const { bands } = gelRects(gelSvg(model));
      expect(bands.size).toBe(model.lanes.length);
      for (const rects of bands.values()) {
        const sorted = [...rects].sort((a, b) => a.y - b.y);
        for (let i = 1; i < sorted.length; i++) {
          // Strictly clear: the next band starts after this one ends.
          expect(sorted[i].y).toBeGreaterThan(sorted[i - 1].y + sorted[i - 1].h);
        }
      }
    }
  });

  test.each(allLadders.map((l) => [l.id, l] as const))("%s: every band, the largest included, sits clear below its well", (_id, ladder) => {
    const model = buildGel({ ladder, lanes: STRESS_LANES });
    if ("error" in model) throw new Error(model.error);
    const { bands, wells } = gelRects(gelSvg(model));
    for (const [lane, rects] of bands) {
      const well = wells.get(lane);
      expect(well).toBeDefined();
      const wellBottom = well!.y + well!.h;
      for (const r of rects) expect(r.y).toBeGreaterThanOrEqual(wellBottom + 5);
    }
  });

  test("NEB 1 kb: the 517 and 500 bp rows draw as ONE band labelled 500/517, as NEB prints it", () => {
    const model = buildGel({ ladder: NEB_1KB, lanes: [{ name: "A", sizes: [3000] }] });
    if ("error" in model) throw new Error(model.error);
    const ladderLane = model.lanes[0];
    expect(ladderLane.bands).toHaveLength(10); // NEB: "10 bands"
    expect(ladderLane.bands[9].sizes).toEqual([517, 500]);
    const svg = gelSvg(model);
    expect(svg).toMatch(/>500\/517</);
    expect(svg).not.toMatch(/>517</);
  });

  test("NEB 100 bp and 1 kb Plus doublets are labelled 500/517 too", () => {
    for (const ladder of [NEB_100BP, NEB_PLUS]) {
      const model = buildGel({ ladder, lanes: [{ name: "A", sizes: [1000] }] });
      if ("error" in model) throw new Error(model.error);
      expect(model.lanes[0].bands).toHaveLength(ladder.bands.length);
      expect(gelSvg(model)).toMatch(/>500\/517</);
    }
  });

  test("sample bands that would draw overlapping are merged and the text says so", () => {
    const out = run("cloning-gel", { lanes: "Edge pile-up: 50000, 30000, 20000" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/drawn closer than one band height at this scale, so they are drawn as ONE band/);
    // Every off-scale fragment is still named.
    for (const s of ["50.0 kb", "30.0 kb", "20.0 kb"]) expect(out.text).toContain(s);
  });

  test("lane names are never truncated: long ones turn vertical, short ones stay across", () => {
    const longNames = buildGel({
      ladder: NEB_1KB,
      lanes: [
        { name: "Digest A", sizes: [3000] },
        { name: "PCR product", sizes: [1200] },
        { name: "pUC19 EcoRI + HindIII", sizes: [2600] },
      ],
    });
    if ("error" in longNames) throw new Error(longNames.error);
    const svg = gelSvg(longNames);
    expect(svg).not.toMatch(/…/);
    for (const name of ["Digest A", "PCR product", "pUC19 EcoRI + HindIII"]) expect(svg).toContain(name);
    expect(svg).toMatch(/rotate\(-90 /);

    const shortNames = buildGel({ ladder: NEB_1KB, lanes: [{ name: "A", sizes: [3000] }, { name: "B2", sizes: [800] }] });
    if ("error" in shortNames) throw new Error(shortNames.error);
    expect(gelSvg(shortNames)).not.toMatch(/rotate\(-90 /);
  });

  test("a lane name longer than 32 characters is refused by name, not truncated", () => {
    const out = run("cloning-gel", { lanes: "This lane name is far too long to draw in full: 1000" });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/lane names are drawn in full/);
  });
});

// --------------------------------- integrator review round 1b (reviewer repros)
//
// Repros: scratchpad/review-c1b/{defect1-gibson-dupname, defect2-pcr-label-clipped,
// probeGel §4, defect4-custom-ladder}.ts. Every one is a row here.

describe("review 1b: duplicate part names (defect 1)", () => {
  const frag = (name: string, seed: number): { name: string; seq: string } => {
    let s = seed;
    const rnd = (): number => ((s = (s * 48271) % 2147483647) / 2147483647);
    return { name, seq: Array.from({ length: 120 }, () => "ACGT"[Math.floor(rnd() * 4)]).join("") };
  };
  const XYX = [frag("X", 7), frag("Y", 13), frag("X", 29)];

  test.each([false, true])("Gibson refuses X, Y, X by name (circular=%s)", (circular) => {
    const r = gibson({ fragments: XYX, circular, mode: "length", overlapLength: 20 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/2 of these sequences are called “X” \(positions 1 and 3\)/);
  });

  test("Golden Gate refuses duplicate part names too", () => {
    const r = goldenGate({ parts: XYX, enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/called “X” \(positions 1 and 3\)/);
  });

  test("a backbone sharing a part's name is refused (the two fields are read separately)", () => {
    const parts = readParts(GG_PARTS, "Parts");
    if ("ok" in parts) throw new Error(parts.error);
    const r = goldenGate({ parts: parts.parts, enzyme: "BsaI", backbone: { name: "cds", seq: parts.parts[1].seq } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/called “cds”/);
  });

  test("readParts refuses duplicates, naming both positions", () => {
    const r = readParts("X: ACGTACGTACGTACGTACGTACGT\nY: TTGACTTGACTTGACTTGACTTGA\nX: GGCCGGCCGGCCGGCCGGCCGGCC", "Parts");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("positions 1 and 3") });
  });

  test("tails are keyed by POSITION: every reverse primer carries its own junction's overlap", () => {
    // The defect behind the refusal: with distinct names the tails must still be
    // index-correct, in both topologies and for the fragment that closes a circle.
    const named = [frag("A", 7), frag("B", 13), frag("C", 29)];
    for (const circular of [false, true]) {
      const r = gibson({ fragments: named, circular, mode: "length", overlapLength: 20 });
      if (!r.ok) throw new Error(r.error);
      named.forEach((f, i) => {
        const rev = r.primers.find((p) => p.name === `${f.name} reverse`)!;
        const downstream = circular ? named[(i + 1) % named.length] : named[i + 1];
        const want = downstream ? reverseComplement(downstream.seq.slice(0, 20)) : "";
        expect(rev.tail).toBe(want);
      });
      for (const j of r.junctions) {
        expect(j.upstreamIndex).toBe(named.findIndex((f) => f.name === j.upstream));
        expect(j.downstreamIndex).toBe(named.findIndex((f) => f.name === j.downstream));
      }
    }
  });
});

describe("review 1b: PCR map labels stay on the canvas (defect 2)", () => {
  const template = (() => {
    let s = 11;
    const rnd = (): number => ((s = (s * 48271) % 2147483647) / 2147483647);
    return Array.from({ length: 4000 }, () => "ACGT"[Math.floor(rnd() * 4)]).join("");
  })();

  test.each([
    ["region at the 3′ end", 3900, 4000],
    ["region at the 5′ end", 1, 101],
    ["the whole template", 1, 4000],
    ["a region in the middle", 1900, 2100],
  ])("%s: no label escapes the 420 px canvas", (_what, start, end) => {
    const r = pcrPrimers({ template, start, end });
    if (!r.ok) throw new Error(r.error);
    const svg = primerMapSvg(r, template.length);
    const W = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)![1]);
    const ADV = 9 * 0.58;
    let checked = 0;
    for (const m of svg.matchAll(/<text x="([\d.]+)" y="[\d.]+"([^>]*)>([^<]*)<\/text>/g)) {
      const x = Number(m[1]);
      const anchor = /text-anchor="(\w+)"/.exec(m[2])?.[1] ?? "start";
      const w = m[3].length * ADV;
      const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
      expect({ label: m[3], x0 }).toEqual({ label: m[3], x0: expect.any(Number) });
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(x0 + w).toBeLessThanOrEqual(W);
      checked++;
    }
    expect(checked).toBeGreaterThan(4);
  });
});

describe("review 1b: a site the assembly itself creates (defect 3)", () => {
  // part A ends ...GGT and part B begins CTC..., so the PRODUCT spells GGTCTC
  // across the junction although neither part contains it.
  const tail = "ACGTTGCAAGGTCATCGATCAGGT";
  const partA = { name: "A", seq: "AATG" + "CAGTCCTAGGTATAATGCTAGCAAGG" + tail };
  const partB = { name: "B", seq: "CTCA" + "GTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACT" };

  test("a BsaI site spanning a junction is refused, naming the junction", () => {
    const r = goldenGate({ parts: [partA, partB], enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/SPELLS a new BsaI site \(GGTCTC\)/);
    expect(r.error).toMatch(/A → B junction/);
    expect(r.error).toMatch(/No part contains that site on its own/);
  });

  test("a site spanning the junction that CLOSES the circle is refused as such", () => {
    // Last part ends ...GGT, first part begins CTCA: only the wrap spells it.
    const first = { name: "first", seq: "CTCA" + "GTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACT" };
    const last = { name: "last", seq: "AAGG" + "CAGTCCTAGGTATAATGCTAGCAAGG" + tail };
    const r = goldenGate({ parts: [first, last], enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/SPELLS a new BsaI site/);
    expect(r.error).toMatch(/closes the circle, last → first/);
  });

  test("the reverse strand of the product is searched too", () => {
    // ...GAG | ACC... spells GAGACC, which is GGTCTC on the other strand.
    const a = { name: "A", seq: "AATG" + "CAGTCCTAGGTATAATGCTAGCAAGGCTTTACACTTGAG" };
    const b = { name: "B", seq: "ACCA" + "GTCAGTCCTAGGTATAATGCTAGCAAGGCTTTACACT" };
    const r = goldenGate({ parts: [a, b], enzyme: "BsaI" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/reverse strand/);
  });

  test("the 400-design fuzz: no ACCEPTED design's product carries the enzyme's site", () => {
    let s = 7;
    const rnd = (): number => ((s = (s * 48271) % 2147483647) / 2147483647);
    const rs = (n: number): string => Array.from({ length: n }, () => "ACGT"[Math.floor(rnd() * 4)]).join("");
    let accepted = 0;
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(rnd() * 3);
      const parts = Array.from({ length: n }, (_, i) => ({ name: `p${i}`, seq: rs(60 + Math.floor(rnd() * 60)) }));
      const r = goldenGate({ parts, enzyme: "BsaI" });
      if (!r.ok) continue;
      accepted++;
      const product = parts.map((p) => p.seq).join("");
      const wrapped = product + product.slice(0, 8);
      expect(wrapped).not.toMatch(/GGTCTC|GAGACC/);
    }
    expect(accepted).toBeGreaterThan(100);
  });
});

describe("review 1b: custom ladder sanity (defect 4)", () => {
  test("sizes that collapse to one distinct band are refused by name", () => {
    expect(customLadder([1000, 1000])).toEqual({
      error: expect.stringContaining("at least two DIFFERENT band sizes; every size given was 1,000 bp"),
    });
    const out = run("cloning-gel", { ladder: "custom", custom: "1000, 1000", lanes: "A: 700" });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/two DIFFERENT band sizes/);
  });

  test("a ladder spanning less than two-fold is refused by name", () => {
    expect(customLadder([1000, 1001])).toEqual({ error: expect.stringContaining("spans only 1.00-fold") });
    expect(customLadder([1000, 1900])).toEqual({ error: expect.stringContaining("1.90-fold") });
  });

  test("exactly two-fold is accepted, and places a midpoint between its bands", () => {
    const made = customLadder([2000, 1000]);
    if ("error" in made) throw new Error(made.error);
    expect(made.bands.map((b) => b.sizes[0])).toEqual([2000, 1000]);
    const mid = migrationPos(1414, made).pos;
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
  });
});

describe("review 1b: primerTm symmetry correction (defect 5, dna.ts)", () => {
  // ORACLE: Bio.SeqUtils.MeltingTemp.Tm_NN, nn_table=DNA_NN3 (SantaLucia 1998
  // unified, the table dna.ts transcribes), Na=50, saltcorr=5, and
  // dnac1=dnac2=125 nM for a normal oligo / dnac1=250 nM with selfcomp=True for
  // a palindrome — which is primerTm's primer/4 and primer at its 0.25 µM
  // default. Script: scratchpad/tm_oracle2.py. Before the fix every
  // self-complementary value was 1.1–2.0 °C too HOT (DNA_NN3's own
  // sym = (0, −1.4) zeroed); non-self-complementary values are unchanged.
  test.each([
    ["GAATTCGAATTC", 29.2918682255],
    ["ACGTACGTACGTACGT", 49.9390551511],
    ["AAGCTTAAGCTT", 32.1302230437],
    ["GGTACCGGTACC", 40.3766886867],
    ["CATGGCCATGGCCATG", 53.5591915972],
    ["AATTGGCCAATT", 33.3297046217],
    ["TTAATTAA", -7.4644277286],
    ["GCGCGCGCGCGCGCGC", 73.7320448594],
  ])("self-complementary %s matches Biopython Tm_NN", (seq, expected) => {
    expect(reverseComplement(seq)).toBe(seq);
    expect(primerTm(seq).tm).toBeCloseTo(expected, 8);
  });

  test.each([
    ["ATGCATGCATGCATGCATGC", 57.6833936524],
    ["GGGGCCCCGGGGCCCCAAAT", 68.2386747557],
    ["ACGTTGCAAGGTCATCGATC", 55.1261548484],
    ["TTTTTTTTTTTTTTTTTTTA", 37.1755822612],
    ["AATGGTCAGTCCTAGGTATAATGCTAGC", 57.6392007235],
    ["GCGCGCGCGCGCGCGCGCGA", 78.1067542632],
  ])("non-self-complementary %s is UNCHANGED by the fix", (seq, expected) => {
    expect(reverseComplement(seq)).not.toBe(seq);
    expect(primerTm(seq).tm).toBeCloseTo(expected, 8);
  });

  test("the correction only ever lowers a palindrome's Tm, never a normal oligo's", () => {
    // ΔS°sym = −1.4 makes the denominator more negative, so Tm falls.
    const pal = primerTm("GAATTCGAATTC");
    expect(pal.deltaS).toBeLessThan(primerTm("GAATTCGAATTG").deltaS!);
  });

  test("the cloning tools inherit the corrected Tm (no second model anywhere)", () => {
    const r = pcrPrimers({ template: TEMPLATE, start: 1, end: 336, targetTm: 60 });
    if (!r.ok) throw new Error(r.error);
    expect(r.forward.tm.tm).toBe(primerTm(r.forward.anneal).tm);
    expect(r.reverse.tm.tm).toBe(primerTm(r.reverse.anneal).tm);
  });
});

// ------------------------------------------------- the calculators and figures

describe("the calculators", () => {
  test("all four are in the Molecular cloning group and every one draws", () => {
    expect(CLONING_CALCS.map((c) => c.id)).toEqual([
      "cloning-gel",
      "cloning-golden-gate",
      "cloning-gibson",
      "cloning-pcr-primers",
    ]);
    for (const c of CLONING_CALCS) {
      expect(c.group).toBe("Molecular cloning");
      const out = run(c.id);
      expect(out.ok).not.toBe(false);
      const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
      expect(plots.length).toBeGreaterThan(0);
      for (const b of plots) {
        if (b.kind !== "plot") continue;
        expect(b.svg.startsWith("<svg")).toBe(true);
        expect(b.svg.trim().endsWith("</svg>")).toBe(true);
        expect(b.w).toBeGreaterThan(100);
        expect(b.h).toBeGreaterThan(50);
        expect(b.caption.length).toBeGreaterThan(10);
        expect(b.alt.length).toBeGreaterThan(10);
      }
    }
  });

  test("the display contract holds for every default result and every caption", () => {
    for (const c of CLONING_CALCS) {
      const out = run(c.id);
      const captions = ((out.blocks ?? []).filter((b) => b.kind === "plot") as { caption: string; alt: string }[])
        .map((b) => `${b.caption} ${b.alt}`)
        .join(" ");
      const all = `${out.text} ${captions}`;
      expect(all).not.toMatch(/—/); // no em dash: the pane's insert gate refuses it
      expect(all).not.toMatch(/NaN|Infinity|undefined/);
      expect(all).not.toMatch(/\d[eE][+-]\d/); // no e-notation
      expect(all).not.toMatch(/\^/); // no carets
    }
  });

  test("a refusal is ok:false with a plain sentence, never a figure", () => {
    const out = run("cloning-gel", { lanes: "", seq: "" });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/Nothing to run/);
    expect((out as { blocks?: unknown[] }).blocks).toBeUndefined();
  });

  test("the gel figure is one SVG per lane set, with the ladder labelled", () => {
    const model = buildGel({ ladder: NEB_1KB, lanes: [{ name: "Digest", sizes: [3001, 1500] }] });
    if ("error" in model) throw new Error(model.error);
    const svg = gelSvg(model);
    expect(svg).toMatch(/10,002/);
    expect(svg).toMatch(/Ladder/);
    // Literal hex only: inserted artwork must not follow the pane theme.
    expect(svg).not.toMatch(/currentColor|var\(--/);
  });
});

describe("cloning review round 3", () => {
  // R3-03: an unnamed backbone was auto-named "part 1" and collided with the first unnamed part.
  let s = 99;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const rs = (n: number) => Array.from({ length: n }, () => "ACGT"[Math.floor(rnd() * 4)]).join("");
  const p1 = rs(60), p2 = rs(60), bb = rs(200);
  it("R3-03: unnamed parts with an unnamed backbone design without a 'part 1' clash", () => {
    const r = run("cloning-golden-gate", { parts: p1 + "\n" + p2, backbone: bb });
    expect(r.text).not.toMatch(/called "part 1"/);
  });
  it("R3-03: an unnamed backbone is called backbone in the output", () => {
    const r = run("cloning-golden-gate", { parts: "A: " + p1 + "\nB: " + p2, backbone: bb });
    if (r.ok !== false) expect(r.text).toMatch(/backbone/);
    expect(r.text).not.toMatch(/→ part 1/);
  });
});
