// v2.193 bio fix round: pinned regressions for confirmed defects in the
// sequence / assay / alignment / restriction-enzyme modules. Every expected
// number below comes from an external oracle (the script is quoted beside it).

import { buildSt26Xml, cleanResidues, definedResidueCount, featureNotes, featureWarnings, type SequenceEntry, type SequenceListingMeta } from "../sequence";
import { fitDoseResponse, fitSaturationBinding, levenbergMarquardt } from "../assay";
import { standardCurve } from "../assayQuant";
import { assaySig } from "../assayFormat";

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
