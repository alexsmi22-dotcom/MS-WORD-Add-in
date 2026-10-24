// v2.193 bio fix round: pinned regressions for confirmed defects in the
// sequence / assay / alignment / restriction-enzyme modules. Every expected
// number below comes from an external oracle (the script is quoted beside it).

import { buildSt26Xml, cleanResidues, definedResidueCount, featureNotes, featureWarnings, type SequenceEntry, type SequenceListingMeta } from "../sequence";
import { fitDoseResponse, fitSaturationBinding, levenbergMarquardt } from "../assay";
import { standardCurve } from "../assayQuant";
import { assaySig } from "../assayFormat";
import { featureLength, parseGenBank, parseLocation, type SeqRecord } from "../seqio";
import { parseSnapGeneDna } from "../seqdna";
import { buildCircularMapSvg } from "../seqmapcirc";
import { ENZYMES, findSites, formatSite, type Enzyme } from "../enzymes";
import { align } from "../align";
import { bandText, buildGel, LADDERS } from "../gel";
import { gelAlt } from "../gelChart";

const META: SequenceListingMeta = { applicantName: "A", inventionTitle: "B", applicantFileReference: "R1", productionDate: "2026-10-24" };

// ---------------------------------------------------------------------------
// 1. ST.26 RNA uses "t" (WIPO ST.26 paragraph 14) — and synthetic constructs
//    take mol_type "other DNA"/"other RNA" (paragraph 84(a)).
// ---------------------------------------------------------------------------
describe("1. ST.26 RNA is written with t, not u (ST.26 ¶14)", () => {
  test("t in an RNA entry is kept (it used to be DROPPED as invalid)", () => {
    const r = cleanResidues("RNA", "acgtacgtac");
    expect(r.residues).toBe("acgtacgtac");
    expect(r.invalid).toEqual([]);
    expect(r.uracilAsT).toBeUndefined();
  });
  test("a typed u is written as t, and counted for the note", () => {
    const r = cleanResidues("RNA", "AUGC UUAG");
    expect(r.residues).toBe("atgcttag");
    expect(r.uracilAsT).toBe(3);
    expect(definedResidueCount("RNA", r.residues)).toBe(8);
  });
  test("DNA still treats u as invalid", () => {
    expect(cleanResidues("DNA", "acgu").invalid).toEqual(["u"]);
  });
  test("the XML carries t, and a note says u was written as t", () => {
    const e: SequenceEntry = { moltype: "RNA", residues: "augcaugcaugcaugc", organism: "Homo sapiens", sourceMolType: "mRNA" };
    const xml = buildSt26Xml(META, [e]);
    expect(xml).toContain("<INSDSeq_sequence>atgcatgcatgcatgc</INSDSeq_sequence>");
    expect(xml).not.toMatch(/<INSDSeq_sequence>[^<]*u/);
    expect(featureNotes(e).join(" ")).toMatch(/4 “u” written as “t”: WIPO ST\.26 paragraph 14/);
  });
  test("an RNA of ten t-containing residues meets the ST.26 ¶8 minimum", () => {
    const xml = buildSt26Xml(META, [{ moltype: "RNA", residues: "acgtacgtac", organism: "Homo sapiens", sourceMolType: "mRNA" }]);
    expect(xml).toContain("<SequenceTotalQuantity>1</SequenceTotalQuantity>");
  });
});

describe("1b. synthetic construct → mol_type other DNA / other RNA (ST.26 ¶84(a))", () => {
  test("blank organism (synthetic construct) with the dropdown's first value 'genomic DNA' → other DNA, with a note", () => {
    const e: SequenceEntry = { moltype: "DNA", residues: "acgtacgtacgt", sourceMolType: "genomic DNA" };
    const xml = buildSt26Xml(META, [e]);
    expect(xml).toContain("<INSDQualifier_value>other DNA</INSDQualifier_value>");
    expect(xml).not.toContain(">genomic DNA<");
    expect(featureNotes(e).join(" ")).toMatch(/“genomic DNA” was written as “other DNA”.*paragraph 84\(a\)/);
  });
  test("RNA: mRNA from a synthetic construct → other RNA", () => {
    const xml = buildSt26Xml(META, [{ moltype: "RNA", residues: "acgtacgtacgt", organism: "synthetic construct", sourceMolType: "mRNA" }]);
    expect(xml).toContain("<INSDQualifier_value>other RNA</INSDQualifier_value>");
  });
  test("a real organism keeps genomic DNA, and no note", () => {
    const e: SequenceEntry = { moltype: "DNA", residues: "acgtacgtacgt", organism: "Homo sapiens", sourceMolType: "genomic DNA" };
    expect(buildSt26Xml(META, [e])).toContain("<INSDQualifier_value>genomic DNA</INSDQualifier_value>");
    expect(featureNotes(e)).toEqual([]);
  });
  test("protein is untouched", () => {
    expect(buildSt26Xml(META, [{ moltype: "AA", residues: "MKLVNT" }])).toContain("<INSDQualifier_value>protein</INSDQualifier_value>");
  });
});

// ---------------------------------------------------------------------------
// 9. A CDS with an internal stop: warn, and no auto /translation.
// ---------------------------------------------------------------------------
describe("9. CDS with an in-frame internal stop", () => {
  const cds = (residues: string, quals: Array<[string, string]> = [], location = `1..${residues.length}`): SequenceEntry => ({
    moltype: "DNA",
    residues,
    organism: "Homo sapiens",
    features: [{ key: "CDS", location, qualifiers: quals.map(([name, value]) => ({ name, value })) }],
  });
  test("ATGAAATAGCCCGGGTTTAAATAA (CDS 1..24): warning, no /translation, no note", () => {
    const e = cds("ATGAAATAGCCCGGGTTTAAATAA");
    expect(buildSt26Xml(META, [e])).not.toContain("translation");
    expect(featureWarnings(e)).toEqual([
      "CDS (1..24) has an in-frame stop codon TAG at bases 7..9 (codon 3) before its last codon — no /translation was generated. " +
        "Check the location and reading frame, or supply /translation yourself.",
    ]);
    expect(featureNotes(e)).toEqual([]);
  });
  test("coordinates are absolute: the same CDS at 4..27", () => {
    const e = cds("GGGATGAAATAGCCCGGGTTTAAATAA", [], "4..27");
    expect(featureWarnings(e).join(" ")).toMatch(/TAG at bases 10\.\.12 \(codon 3\)/);
  });
  test("a terminal stop is fine: ATGAAACCCGGGTTTAAATAA → MKPGFK", () => {
    const e = cds("ATGAAACCCGGGTTTAAATAA");
    expect(buildSt26Xml(META, [e])).toContain("<INSDQualifier_value>MKPGFK</INSDQualifier_value>");
    expect(featureWarnings(e)).toEqual([]);
  });
  test("a Sec /transl_except at the TGA is not a stop", () => {
    const e = cds("ATGAAATGACCCTAA", [["transl_except", "(pos:7..9,aa:Sec)"]]);
    expect(buildSt26Xml(META, [e])).toContain("<INSDQualifier_value>MKUP</INSDQualifier_value>");
    expect(featureWarnings(e)).toEqual([]);
  });
  test("a drafter-supplied /translation is kept, with the warning", () => {
    const e = cds("ATGAAATAGCCCGGGTTTAAATAA", [["translation", "MK"]]);
    expect(buildSt26Xml(META, [e])).toContain("<INSDQualifier_value>MK</INSDQualifier_value>");
    expect(featureWarnings(e).join(" ")).toMatch(/your \/translation was kept as typed/);
  });
});

// ---------------------------------------------------------------------------
// 2. Molar EC50 / Kd fits (Levenberg-Marquardt step size) — scipy oracle.
// ---------------------------------------------------------------------------
//   import numpy as np; from scipy.optimize import curve_fit
//   x = np.logspace(-9, -4, 10)
//   y = [8.90, 9.07, 34.83, 77.32, 97.54, 92.07, 89.96, 95.80, 97.07, 93.64]
//   f4 = lambda x, B, T, C, h: B + (T - B) / (1 + (C / x) ** h)
//   curve_fit(f4, x, y, p0=[8.9, 93.64, 1e-7, 1])
//   → B 7.347151558, T 94.47777752, C 2.024942687e-08, h 1.838920485
//     SE   2.8306,       1.41257,      1.98394e-09,       0.26014
const LOGX = [
  1e-9, 3.5938136638046257e-9, 1.2915496650148827e-8, 4.641588833612782e-8, 1.668100537200059e-7,
  5.994842503189409e-7, 2.1544346900318865e-6, 7.742636826811277e-6, 2.782559402207126e-5, 1e-4,
];
const LOGY = [8.9, 9.07, 34.83, 77.32, 97.54, 92.07, 89.96, 95.8, 97.07, 93.64];
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe("2. molar EC50 / Kd fit", () => {
  test("4PL on molar concentrations matches scipy curve_fit", () => {
    const f = fitDoseResponse(LOGX, LOGY);
    expect(f.converged).toBe(true);
    expect(rel(f.ec50, 2.0249426872833093e-8)).toBeLessThan(1e-4);
    expect(rel(f.hill, 1.8389204851822178)).toBeLessThan(1e-4);
    expect(rel(f.bottom, 7.347151558314868)).toBeLessThan(1e-3);
    expect(rel(f.top, 94.47777752099068)).toBeLessThan(1e-4);
    expect(rel(f.se[2], 1.9839445704452618e-9)).toBeLessThan(1e-3);
    expect(rel(f.se[3], 0.2601401205522651)).toBeLessThan(1e-3);
  });
  test("the same data in nM gives the same fit (scale invariance)", () => {
    const f = fitDoseResponse(LOGX.map((x) => x * 1e9), LOGY);
    expect(f.converged).toBe(true);
    expect(rel(f.ec50, 20.249426872833093)).toBeLessThan(1e-4);
  });
  //   L = [0.5,1,2,4,8,16,32,64]·1e-9; B = 1000·L/(5e-9+L) + [5,−8,6,−4,7,−5,3,−2]
  //   curve_fit(lambda L, Bm, Kd: Bm*L/(Kd+L), L, B, p0=[1000, 1e-8])
  //   → Bmax 999.0271835937942, Kd 4.976026655363389e-09 (SE 5.8032, 1.01167e-10)
  test("one-site binding with Kd in M matches scipy", () => {
    const L = [0.5, 1, 2, 4, 8, 16, 32, 64].map((v) => v * 1e-9);
    const B = [
      95.90909090909092, 158.66666666666669, 291.7142857142858, 440.44444444444446, 622.3846153846155, 756.9047619047619,
      867.864864864865, 925.536231884058,
    ];
    const f = fitSaturationBinding(L, B);
    expect(f.converged).toBe(true);
    expect(rel(f.kd, 4.976026655363389e-9)).toBeLessThan(1e-4);
    expect(rel(f.bmax, 999.0271835937942)).toBeLessThan(1e-4);
    expect(rel(f.kdSE, 1.0116749175302744e-10)).toBeLessThan(1e-3);
  });
  //   sx = [1e-9,2e-9,5e-9,1e-8,2e-8,5e-8,1e-7,2e-7,5e-7,1e-6]; sy as below
  //   curve_fit(f4, sx, sy, p0=[0.05,2,3e-8,1]) → C 2.997299834e-08, h 1.198313455
  //   and with sx·1e9: C 29.9729983237372 (same curve)
  test("standardCurve 4PL on molar standards fits, same as ×10⁹ scaled", () => {
    const sx = [1e-9, 2e-9, 5e-9, 1e-8, 2e-8, 5e-8, 1e-7, 2e-7, 5e-7, 1e-6];
    const sy = [
      0.0923756158113241, 0.11081124112493303, 0.26142559338275206, 0.4566361893149202, 0.8023742017709579, 1.3058143235393607,
      1.6339240486720064, 1.8144856173087913, 1.942550483287742, 1.9654131524997176,
    ];
    const molar = standardCurve(sx.map((conc, i) => ({ conc, responses: [sy[i]] })), [{ name: "u", responses: [1.0] }], "4pl");
    const nano = standardCurve(sx.map((conc, i) => ({ conc: conc * 1e9, responses: [sy[i]] })), [{ name: "u", responses: [1.0] }], "4pl");
    expect(molar.ok).toBe(true);
    expect(nano.ok).toBe(true);
    if (!molar.ok || !nano.ok || molar.curve.model !== "4pl" || nano.curve.model !== "4pl") throw new Error("unreachable");
    expect(rel(molar.curve.ec50, 2.997299834034331e-8)).toBeLessThan(1e-4);
    expect(rel(molar.curve.hill, 1.1983134545623435)).toBeLessThan(1e-4);
    expect(rel(nano.curve.ec50, 29.9729983237372)).toBeLessThan(1e-4);
    const um = molar.unknowns[0];
    const un = nano.unknowns[0];
    if (um.status !== "ok" || un.status !== "ok") throw new Error("unknown not read");
    expect(rel((um.conc ?? NaN) * 1e9, un.conc ?? NaN)).toBeLessThan(1e-4);
  });
  test("an undeterminable parameter is NOT converged (singular JᵀJ)", () => {
    // y depends on a·b only: a and b trade off exactly.
    const x = [1, 2, 3, 4, 5, 6];
    const f = levenbergMarquardt(x, x.map((v) => 3 * v), ([a, b], xi) => a * b * xi, [1, 1]);
    expect(f.converged).toBe(false);
  });
  test("a model that goes NaN is NOT converged (it used to be reported converged at the seed)", () => {
    const x = [1, 2, 3, 4, 5];
    const f = levenbergMarquardt(x, [1, 2, 3, 4, 5], ([a], xi) => (a > 0 ? NaN : a * xi), [1]);
    expect(f.converged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. assaySig: ×10ⁿ, never e-notation; true minus.
// ---------------------------------------------------------------------------
describe("7. assaySig display contract", () => {
  test.each([
    [1.2094e-8, 4, "1.209×10⁻⁸"],
    [-1.2094e-8, 4, "−1.209×10⁻⁸"],
    [6.02214076e23, 4, "6.022×10²³"],
    [-2.5, 4, "−2.5"],
    [0.000123456, 4, "0.0001235"],
    [1200000, 2, "1200000"],
  ])("%p at %p sf → %p", (x, sig, want) => {
    expect(assaySig(x, sig)).toBe(want);
  });
  test("no e-notation anywhere in the molar fit's caveats", () => {
    const f = fitDoseResponse(LOGX.slice(0, 4), LOGY.slice(0, 4));
    for (const c of f.caveats) expect(c).not.toMatch(/\de[+-]?\d/);
  });
});

// ---------------------------------------------------------------------------
// 3 + 5. GenBank locations: origin-spanning joins; all-complement joins.
// ---------------------------------------------------------------------------
function genbank(locs: string[], len = 3000, topology = "circular"): string {
  const feats = locs.map((l, i) => `     misc_feature    ${l}\n                     /label="f${i + 1}"`).join("\n");
  const seq = "acgt".repeat(len / 4);
  const rows: string[] = [];
  for (let i = 0; i < seq.length; i += 60) rows.push(`${String(i + 1).padStart(9)} ${seq.slice(i, i + 60)}`);
  return (
    `LOCUS       TEST                    ${len} bp    DNA     ${topology} SYN 01-JAN-2026\n` +
    `FEATURES             Location/Qualifiers\n${feats}\nORIGIN\n${rows.join("\n")}\n//\n`
  );
}
function only(text: string): SeqRecord {
  const r = parseGenBank(text);
  if (!r.ok) throw new Error(r.error);
  return r.records[0];
}

describe("3. origin-spanning join on a circular record", () => {
  test("join(2801..3000,1..150) on 3000 bp → start 2801, end 150, wraps, 350 bp", () => {
    const f = only(genbank(["join(2801..3000,1..150)"])).features[0];
    expect(f.start).toBe(2801);
    expect(f.end).toBe(150);
    expect(f.wraps).toBe(true);
    expect(f.segments).toEqual([{ start: 2801, end: 3000 }, { start: 1, end: 150 }]);
    expect(featureLength(f, 3000)).toBe(350);
  });
  test("complement(join(2801..3000,1..150)) wraps too, on the minus strand", () => {
    const f = only(genbank(["complement(join(2801..3000,1..150))"])).features[0];
    expect([f.start, f.end, f.wraps, f.strand]).toEqual([2801, 150, true, -1]);
  });
  test("join(complement(1..150),complement(2801..3000)) (minus-strand order) wraps, strand −1", () => {
    const f = only(genbank(["join(complement(1..150),complement(2801..3000))"])).features[0];
    expect([f.start, f.end, f.wraps, f.strand]).toEqual([2801, 150, true, -1]);
  });
  test("an ordinary exon join is NOT a wrap", () => {
    const f = only(genbank(["join(10..100,2900..2990)"])).features[0];
    expect([f.start, f.end, f.wraps]).toEqual([10, 2990, undefined]);
  });
  test("on a LINEAR record the same location is not read as a wrap", () => {
    const f = only(genbank(["join(2801..3000,1..150)"], 3000, "linear")).features[0];
    expect(f.wraps).toBeUndefined();
  });
  test("the circular map draws a 350 bp arc (≈42°), not the whole ring", () => {
    const rec = only(genbank(["join(2801..3000,1..150)"]));
    const svg = buildCircularMapSvg(rec, { size: 460 }) as string;
    const path = /<path d="M([\d.]+),([\d.]+) A[\d.]+,[\d.]+ 0 (\d) 1 ([\d.]+),([\d.]+)/.exec(svg);
    expect(path).not.toBeNull();
    const [, x1, y1, large, x2, y2] = path as RegExpExecArray;
    expect(large).toBe("0"); // a short arc, not the >180° one
    const c = 230;
    const ang = (x: string, y: string): number => Math.atan2(Number(y) - c, Number(x) - c);
    let sweep = ang(x2, y2) - ang(x1, y1);
    if (sweep < 0) sweep += 2 * Math.PI;
    // 350 bp of 3000 = 42°, less the arrow head (≤ 0.09 rad ≈ 5.2°) drawn on the body arc.
    expect((sweep * 180) / Math.PI).toBeGreaterThan(36);
    expect((sweep * 180) / Math.PI).toBeLessThan(42.1);
    // It starts just left of 12 o'clock (bp 2801 ≈ 336°) and crosses the top.
    expect(Number(x1)).toBeLessThan(c);
    expect(Number(x2)).toBeGreaterThan(c);
  });
});

describe("5. all-complement joins are on the minus strand", () => {
  test.each([
    ["join(complement(1400..1600),complement(1000..1200))", -1],
    ["complement(join(1000..1200,1400..1600))", -1],
    ["complement(1000..1200)", -1],
    ["join(1000..1200,1400..1600)", 1],
    ["join(complement(1000..1200),1400..1600)", 1], // mixed: not one strand
    ["complement(complement(1000..1200))", 1],
  ])("%s → %p", (loc, strand) => {
    expect(parseLocation(loc as string)?.strand).toBe(strand);
  });
  test("segments keep their written order", () => {
    expect(parseLocation("join(complement(1400..1600),complement(1000..1200))")?.segments).toEqual([
      { start: 1400, end: 1600 },
      { start: 1000, end: 1200 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. SnapGene <Segment range="2801-150"/> wraps the origin.
// ---------------------------------------------------------------------------
function packet(tag: number, data: string): number[] {
  const bytes = [...data].map((c) => c.charCodeAt(0));
  const len = bytes.length;
  return [tag, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...bytes];
}
function snapgene(featuresXml: string, primersXml = "", len = 3000): Uint8Array {
  return new Uint8Array([
    ...packet(0x09, "SnapGene" + "\x00\x01\x00\x0e\x00\x0e"),
    ...packet(0x00, String.fromCharCode(0x02) + "acgt".repeat(len / 4)),
    ...packet(0x0a, featuresXml),
    ...(primersXml ? packet(0x05, primersXml) : []),
  ]);
}

describe("4. SnapGene origin-spanning segments (Biopython: join{[2800:3000],[0:150]})", () => {
  test("Feature range 2801-150 → 2801→150, wraps, 350 bp", () => {
    const r = parseSnapGeneDna(
      snapgene(`<Features><Feature name="ori" type="rep_origin" directionality="1"><Segment range="2801-150" type="standard"/></Feature></Features>`),
    );
    if (!r.ok) throw new Error(r.error);
    const f = r.record.features[0];
    expect([f.start, f.end, f.wraps]).toEqual([2801, 150, true]);
    expect(f.segments).toEqual([{ start: 2801, end: 3000 }, { start: 1, end: 150 }]);
    expect(featureLength(f, 3000)).toBe(350);
  });
  test("Primer binding site 2990-10 wraps as well; an ordinary range does not", () => {
    const r = parseSnapGeneDna(
      snapgene(
        `<Features><Feature name="x" type="CDS" directionality="1"><Segment range="100-400"/></Feature></Features>`,
        `<Primers><Primer name="P"><BindingSite location="2990-10" strand="top"/></Primer></Primers>`,
      ),
    );
    if (!r.ok) throw new Error(r.error);
    const [cds, primer] = r.record.features;
    expect([cds.start, cds.end, cds.wraps]).toEqual([100, 400, undefined]);
    expect([primer.start, primer.end, primer.wraps]).toEqual([2990, 10, true]);
  });
  test("a reversed range that starts beyond the sequence is skipped, not invented", () => {
    const r = parseSnapGeneDna(snapgene(`<Features><Feature name="x" type="CDS"><Segment range="5000-10"/></Feature></Features>`));
    if (!r.ok) throw new Error(r.error);
    expect(r.record.features).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Restriction enzymes: PleI / BciVI bottom cuts, EcoP15I (Type III), end cuts.
// ---------------------------------------------------------------------------
//   from Bio import Restriction as R
//   R.PleI.fst5, R.PleI.ovhg  → 9, −1   (GAGTC(4/5): bottom cut 10)
//   R.BciVI.fst5, R.BciVI.ovhg → 12, +1 (GTATCC(6/5): bottom cut 11)
// The whole table (121 enzymes) was also diffed against Bio.Restriction
// search() on a seeded random 5 kb sequence, circular and linear: 0 differences.
describe("6. restriction enzymes", () => {
  const byName = (n: string): Enzyme => ENZYMES.find((e) => e.name === n) as Enzyme;
  test("PleI GAGTC(4/5) and BciVI GTATCC(6/5) bottom-strand cuts", () => {
    expect([byName("PleI").cutTop, byName("PleI").cutBottom]).toEqual([9, 10]);
    expect([byName("BciVI").cutTop, byName("BciVI").cutBottom]).toEqual([12, 11]);
    expect(formatSite(byName("PleI"))).toBe("GAGTC(4/5)");
    expect(formatSite(byName("BciVI"))).toBe("GTATCC(6/5)");
  });
  test("a REVERSE PleI site cuts the top strand where Bio.Restriction says", () => {
    // GACTC (reverse PleI) at 1-based 21..25 of 60 A's: Bio search → top cut after base 15 (21 − 5 − 1).
    const seq = "A".repeat(20) + "GACTC" + "A".repeat(35);
    const h = findSites(seq, { only: ["PleI"] });
    expect(h.map((x) => [x.strand, x.cutPosition])).toEqual([[-1, 15]]);
  });
  test("EcoP15I (Type III: needs two inversely oriented sites) is not a single-site cutter here", () => {
    expect(ENZYMES.some((e) => e.name === "EcoP15I")).toBe(false);
  });
  test("linear end: AlwI whose top cut lands at 4000/4000 does not cut", () => {
    const seq = "A".repeat(3991) + "GGATC" + "AAAA"; // site 3992..3996, top cut 4000, bottom 4001
    expect(seq.length).toBe(4000);
    const h = findSites(seq, { only: ["AlwI"] });
    expect(h.length).toBe(1);
    expect(h[0].cutPosition).toBeNull();
    expect(findSites(seq, { only: ["AlwI"], circular: true })[0].cutPosition).toBe(4000);
  });
  test("linear end: Sau3AI on a GATC at 797..800 of 800 (bottom cut at 800) does not cut", () => {
    const seq = "A".repeat(796) + "GATC";
    const h = findSites(seq, { only: ["Sau3AI"] });
    expect(h.length).toBe(1);
    expect(h[0].cutPosition).toBeNull();
    // One base more and both strands are cut.
    expect(findSites(seq + "A", { only: ["Sau3AI"] })[0].cutPosition).toBe(796);
  });
});

// ---------------------------------------------------------------------------
// 8. Alignment scores are EMBOSS needle/water's.
// ---------------------------------------------------------------------------
//   from Bio import Align; from Bio.Align import substitution_matrices
//   a = Align.PairwiseAligner(); a.substitution_matrix = substitution_matrices.load("BLOSUM62")
//   a.open_gap_score = -10; a.extend_gap_score = -0.5
//   global: a.mode = "global"; a.end_gap_score = 0  |  local: a.mode = "local"
//   (DNA: a.match_score = 5; a.mismatch_score = -4 instead of the matrix)
describe("8. EMBOSS-equivalent alignment scores", () => {
  test.each([
    ["HEAGAWGHEE", "PAWHEAE", "protein", 15.0, 18.0],
    ["MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQISFVKSHFSRQLEERLGLIEVQ", "protein", 88.5, 88.5],
    ["ACGTACGTTTGACCA", "ACGTACGACCA", "dna", 43.5, 43.5],
    ["GATTACAGATTACA", "TTACAGAT", "dna", 40.0, 40.0],
  ])("%s vs %s (%s): global %p, local %p", (a, b, kind, g, l) => {
    const k = kind as "protein" | "dna";
    expect(align(a as string, b as string, { mode: "global", kind: k })!.score).toBe(g);
    expect(align(a as string, b as string, { mode: "local", kind: k })!.score).toBe(l);
  });
  test("global end gaps are free and shown: GATTACAGATTACA / TTACAGAT", () => {
    const r = align("GATTACAGATTACA", "TTACAGAT", { mode: "global", kind: "dna" })!;
    expect(r.a.replace(/-/g, "")).toBe("GATTACAGATTACA");
    expect(r.b.replace(/-/g, "")).toBe("TTACAGAT");
    expect(r.b).toMatch(/^--/);
    expect(r.b).toMatch(/-$/);
  });
  test("the caveat states the convention, with a true minus", () => {
    const c = align("ACGT", "ACGT", { kind: "dna" })!.caveats.join(" ");
    expect(c).toMatch(/mismatch −4/);
    expect(c).toMatch(/open \+ \(n − 1\)·extend/);
    expect(c).toMatch(/end gaps are free/);
  });
  test("two unrelated residues align with an all-gap global score of 0, not a −4 mismatch", () => {
    const r = align("W", "P", { mode: "global", kind: "protein" })!;
    expect(r.score).toBe(0);
    expect(r.a.replace(/-/g, "")).toBe("W");
    expect(r.b.replace(/-/g, "")).toBe("P");
  });
});

// ---------------------------------------------------------------------------
// Gel: two off-scale small fragments merged into one band are both named.
// ---------------------------------------------------------------------------
describe("gel band text names every merged size", () => {
  test("250 + 100 bp below the NEB 1 kb ladder → 'below the ladder: 250 and 100 bp'", () => {
    const m = buildGel({ ladder: LADDERS[0], lanes: [{ name: "digest", sizes: [3000, 250, 100] }] });
    if ("error" in m) throw new Error(m.error);
    const texts = m.lanes[1].bands.map(bandText);
    expect(texts).toEqual(["3,000 bp", "below the ladder: 250 and 100 bp [drawn as one band at the bottom edge, not to scale]"]);
    expect(texts.join(" ")).not.toMatch(/2 fragments/);
    expect(gelAlt(m)).toMatch(/250 and 100 bp/);
  });
  test("two copies of one size still read as fragments", () => {
    expect(bandText({ sizes: [1200, 1200], size: 1200, offScale: null })).toBe("1,200 bp (2 fragments)");
  });
});
