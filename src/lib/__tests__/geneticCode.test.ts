// NCBI genetic codes (scope docs/SCOPE-CHEMBIO-BATCH.md §B4, acceptance §D3).
//
// The live wrong answer this release fixes: the ST.26 /translation ignored
// /transl_table (a table-2 CDS emitted as MR instead of M; a table-11 GTG CDS as
// VKPGFK where NCBI gives MKPGFK), and findOrfs started only at ATG and cut
// table-4 genes at TGA. Every expected value below is the brief's §D3 oracle
// (Biopython 1.88 translate(table=t) / cds=True, gc.prt 4.6 parsed independently).

import {
  GENETIC_CODES,
  GENETIC_CODE_IDS,
  GC_PRT_VERSION,
  GeneticCodeError,
  contextStopNote,
  differencesFromStandard,
  findGeneticCode,
  geneticCode,
  geneticCodeById,
  geneticCodeLabel,
} from "../geneticCode";
import { buildOrfTableHtml, findOrfs, orfSearchCaption, resolveCodon, translate, translateReport } from "../dna";
import { buildSt26Xml, featureNotes, featureWarnings, translateCds, type SequenceEntry } from "../sequence";

const META = { applicantName: "Test Applicant", inventionTitle: "Test Invention", productionDate: "2026-10-14" };

function cdsEntry(residues: string, quals: Array<[string, string]>, location = `1..${residues.length}`): SequenceEntry {
  return {
    moltype: "DNA",
    residues,
    organism: "Homo sapiens",
    features: [{ key: "CDS", location, qualifiers: quals.map(([name, value]) => ({ name, value })) }],
  };
}
function translationOf(xml: string): string | null {
  const m = /<INSDQualifier_name>translation<\/INSDQualifier_name><INSDQualifier_value>([^<]*)</.exec(xml);
  return m ? m[1] : null;
}

describe("gc.prt 4.6 tables", () => {
  test("27 tables with exactly the ids 1–6, 9–16, 21–33", () => {
    expect(GC_PRT_VERSION).toBe("4.6");
    expect(GENETIC_CODES.length).toBe(27);
    expect(GENETIC_CODE_IDS).toEqual([1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]);
  });

  // §D3 table rows: name, starts, stops, differences from table 1.
  const rows: Array<[number, string, string, string, string[]]> = [
    [1, "Standard", "TTG CTG ATG", "TAA TAG TGA", []],
    [2, "Vertebrate Mitochondrial", "ATT ATC ATA ATG GTG", "TAA TAG AGA AGG", ["TGA→W", "ATA→M", "AGA→*", "AGG→*"]],
    [3, "Yeast Mitochondrial", "ATA ATG GTG", "TAA TAG", ["TGA→W", "CTT→T", "CTC→T", "CTA→T", "CTG→T", "ATA→M"]],
    // gc.prt's full name; the brief's §D3 row abbreviates it.
    [4, "Mold Mitochondrial; Protozoan Mitochondrial; Coelenterate Mitochondrial; Mycoplasma; Spiroplasma",
      "TTA TTG CTG ATT ATC ATA ATG GTG", "TAA TAG", ["TGA→W"]],
    [5, "Invertebrate Mitochondrial", "TTG ATT ATC ATA ATG GTG", "TAA TAG", ["TGA→W", "ATA→M", "AGA→S", "AGG→S"]],
    [11, "Bacterial, Archaeal and Plant Plastid", "TTG CTG ATT ATC ATA ATG GTG", "TAA TAG TGA", []],
  ];
  test.each(rows)("table %i", (id, name, starts, stops, diffs) => {
    const c = geneticCodeById(id);
    expect(c.name).toBe(name);
    expect(c.starts).toEqual(starts.split(" "));
    expect(c.stops).toEqual(stops.split(" "));
    expect(differencesFromStandard(c)).toEqual(diffs);
  });

  // §D3 "pin one changed codon for each".
  test.each([
    [6, "TAA", "Q"], [6, "TAG", "Q"], [12, "CTG", "S"], [22, "TCA", "*"], [23, "TTA", "*"],
    [25, "TGA", "G"], [26, "CTG", "A"], [32, "TAG", "W"], [33, "TAA", "Y"],
    [9, "AAA", "N"], [10, "TGA", "C"], [13, "AGA", "G"], [14, "TAA", "Y"], [15, "TAG", "Q"],
    [16, "TAG", "L"], [21, "ATA", "M"], [24, "AGG", "K"], [29, "TAA", "Y"], [30, "TAA", "E"],
  ])("table %i: %s → %s", (id, codon, aa) => {
    expect(geneticCodeById(id).codons[codon]).toBe(aa);
    expect(geneticCodeById(1).codons[codon]).not.toBe(aa);
  });

  test("table 1 is byte-for-byte the standard code that used to be hand-typed in dna.ts", () => {
    const old: Record<string, string> = {
      TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
      ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
      TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
      ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
      TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
      AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
      TGT: "C", TGC: "C", TGA: "*", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
      AGT: "S", AGC: "S", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
    };
    expect({ ...geneticCodeById(1).codons }).toEqual(old);
  });

  test("context stops exist only in 27, 28, 31", () => {
    const withCtx = GENETIC_CODES.filter((c) => c.contextStops.length).map((c) => [c.id, c.contextStops.join(" ")]);
    expect(withCtx).toEqual([[27, "TGA"], [28, "TAA TAG TGA"], [31, "TAA TAG"]]);
    expect(contextStopNote(28)).toBe(
      "Table 28: TAA/TAG/TGA are read as Q/Q/W; they can also terminate, depending on context — stops are not called.",
    );
    expect(contextStopNote(27)).toBe("Table 27: TGA is read as W; it can also terminate, depending on context — stops are not called.");
    expect(contextStopNote(1)).toBe("");
  });
});

describe("selection by number or name", () => {
  test.each([
    [11, 11], ["11", 11], ["table 11", 11], ["Table 11", 11], ["NCBI table 11", 11], ["transl_table=11", 11],
    ["bacterial", 11], ["Bacterial, Archaeal and Plant Plastid", 11], ["plastid", 11],
    ["vertebrate mitochondrial", 2], ["Vertebrate Mito", 2], ["SGC1", 2],
    ["yeast mito", 3], ["mycoplasma", 4], ["Spiroplasma", 4], ["invertebrate mitochondrial", 5],
    ["Flatworm Mitochondrial", 9], ["standard", 1], ["Balanophoraceae Plastid", 32],
  ])("%p → table %i", (sel, id) => {
    expect(geneticCode(sel as number | string).id).toBe(id);
  });

  test("vertebrate does not match invertebrate", () => {
    expect(geneticCode("invertebrate mito").id).toBe(5);
    expect(geneticCode("vertebrate mito").id).toBe(2);
  });

  test("retired ids 7 and 8 are refused quoting gc.prt", () => {
    const r7 = findGeneticCode(7);
    expect(r7.ok).toBe(false);
    if (!r7.ok) expect(r7.message).toMatch(/merged in code id 4/);
    const r8 = findGeneticCode("table 8");
    expect(r8.ok).toBe(false);
    if (!r8.ok) expect(r8.message).toMatch(/RNA edit/);
  });

  test.each([0, 17, 18, 19, 20, 34, 99, -1, 2.5])("id %p is refused by name", (id) => {
    expect(() => geneticCodeById(id)).toThrow(GeneticCodeError);
    const r = findGeneticCode(id);
    expect(r.ok).toBe(false);
  });

  test.each(["table -1", "table 2.5", "2a", "", "mitochondrial", "mito", "yeast", "klingon"])("%p is refused", (sel) => {
    const r = findGeneticCode(sel);
    expect(r.ok).toBe(false);
  });

  test("an ambiguous name lists the candidates", () => {
    const r = findGeneticCode("mito");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/more than one/);
      expect(r.message).toMatch(/2 \(Vertebrate Mitochondrial\)/);
    }
  });

  test("label is the display form", () => {
    expect(geneticCodeLabel(2)).toBe("NCBI table 2 (Vertebrate Mitochondrial)");
    expect(geneticCodeLabel(2)).not.toMatch(/transl_table/);
  });
});

describe("§D3 translations (Biopython translate(table=t))", () => {
  const cases: Array<[string, Record<number, string>]> = [
    ["ATGAGATGATGGTAA", { 1: "MR*W*", 2: "M*WW*", 3: "MRWW*", 4: "MRWW*", 5: "MSWW*", 11: "MR*W*" }],
    ["ATGATAAGGTGATAA", { 1: "MIR**", 2: "MM*W*", 3: "MMRW*", 4: "MIRW*", 5: "MMSW*", 11: "MIR**" }],
    ["ATGAAATGGTGAAAACCCGGGTTTTAA", {
      1: "MKW*KPGF*", 2: "MKWWKPGF*", 3: "MKWWKPGF*", 4: "MKWWKPGF*", 5: "MKWWKPGF*", 11: "MKW*KPGF*",
    }],
  ];
  for (const [seq, byTable] of cases) {
    for (const [t, expected] of Object.entries(byTable)) {
      test(`${seq} table ${t} → ${expected}`, () => {
        expect(translate(seq, { table: Number(t) })).toBe(expected);
      });
    }
  }

  test("default (no table) is table 1, unchanged", () => {
    expect(translate("ATGAGATGATGGTAA")).toBe("MR*W*");
    expect(translate("ATGAAATGGTGAAAACCCGGGTTTTAA")).toBe("MKW*KPGF*");
  });

  test("tables 27/28/31 read context stops as sense, and the report SAYS so", () => {
    expect(translate("ATGAGATGATGGTAA", { table: 27 })).toBe("MRWWQ");
    expect(translate("ATGAGATGATGGTAA", { table: 28 })).toBe("MRWWQ");
    expect(translate("ATGAGATGATGGTAA", { table: 31 })).toBe("MRWWE");
    const r = translateReport("ATGAGATGATGGTAA", { table: 28 });
    expect(r.notes).toContain("Translated with NCBI table 28 (Condylostoma Nuclear).");
    expect(r.notes.join(" ")).toMatch(/stops are not called/);
  });

  test("the report names the table whenever it is not table 1, and says nothing for table 1", () => {
    expect(translateReport("ATGAGATGATGGTAA", { table: 2 }).notes).toEqual(["Translated with NCBI table 2 (Vertebrate Mitochondrial)."]);
    expect(translateReport("ATGAGATGATGGTAA").notes).toEqual([]);
    expect(translateReport("ATGAGATGATGGTAA").tableLabel).toBe("NCBI table 1 (Standard)");
  });
});

describe("§D3 initiator rule (Biopython cds=True)", () => {
  test.each([
    ["GTGAAACCCGGGTTTAAATAA", 11, "MKPGFK"],
    ["TTGAAACCCTAA", 11, "MKP"],
    ["ATTAAACCCTAA", 2, "MKP"],
    ["CTGAAACCCTAA", 12, "MKP"],
  ])("%s table %i → %s", (seq, table, expected) => {
    expect(translate(seq, { table, initiator: true, stopAtStop: true })).toBe(expected);
    const r = translateReport(seq, { table, initiator: true, stopAtStop: true });
    expect(r.initiatorApplied).toBe(true);
    expect(r.notes.join(" ")).toMatch(/initiator rule/);
  });

  test("GTG is not a table-1 start: plain VKP even with the initiator rule", () => {
    expect(translate("GTGAAACCCTAA", { table: 1, initiator: true, stopAtStop: true })).toBe("VKP");
  });

  test("without the option the initiator rule never fires", () => {
    expect(translate("GTGAAACCCGGGTTTAAATAA", { table: 11, stopAtStop: true })).toBe("VKPGFK");
  });
});

describe("§D3 ST.26 /translation honours /transl_table", () => {
  test("§A-1: table-2 CDS → M (was MR)", () => {
    const xml = buildSt26Xml(META, [cdsEntry("ATGAGATGATGGAAACCCTAA", [["transl_table", "2"]])]);
    expect(translationOf(xml)).toBe("M");
  });

  test("§A-2: table-11 GTG CDS → MKPGFK (was VKPGFK)", () => {
    const e = cdsEntry("GTGAAACCCGGGTTTAAATAA", [["transl_table", "11"]]);
    expect(translationOf(buildSt26Xml(META, [e]))).toBe("MKPGFK");
    expect(featureNotes(e)).toEqual([
      "CDS (1..21): /translation generated with NCBI table 11 (Bacterial, Archaeal and Plant Plastid); " +
        "the first codon GTG is an initiation codon of table 11 and is read as M (initiator rule).",
    ]);
  });

  test("/transl_table=7 → no auto-translation, warning says merged into 4", () => {
    const e = cdsEntry("ATGAAACCCTAA", [["transl_table", "7"]]);
    expect(translationOf(buildSt26Xml(META, [e]))).toBeNull();
    const w = featureWarnings(e).join(" ");
    expect(w).toMatch(/no \/translation was generated/);
    expect(w).toMatch(/merged in code id 4/);
  });

  test("/transl_table=28 → no auto-translation, context-stop warning", () => {
    const e = cdsEntry("ATGAAACCCTAA", [["transl_table", "28"]]);
    expect(translationOf(buildSt26Xml(META, [e]))).toBeNull();
    expect(featureWarnings(e).join(" ")).toMatch(/depending on context/);
  });

  test("no qualifier → table 1, unchanged, no initiator, nothing added", () => {
    const xml = buildSt26Xml(META, [cdsEntry("ATGAGATGATGGAAACCCTAA", [])]);
    expect(translationOf(xml)).toBe("MR");
    expect(xml).not.toMatch(/transl_table/);
    // TTG is a table-1 start, but the initiator rule needs an EXPLICIT qualifier (§E10).
    expect(translationOf(buildSt26Xml(META, [cdsEntry("TTGAAACCCTAA", [])])) ).toBe("LKP");
    expect(featureNotes(cdsEntry("TTGAAACCCTAA", []))).toEqual([]);
  });

  test("an explicit /transl_table=1 counts: TTG → M", () => {
    expect(translationOf(buildSt26Xml(META, [cdsEntry("TTGAAACCCTAA", [["transl_table", "1"]])]))).toBe("MKP");
  });

  test("translateCds keeps its old signature and defaults", () => {
    expect(translateCds("ATGAGATGATGGAAACCCTAA")).toBe("MR");
    expect(translateCds("ATGAGATGATGGAAACCCTAA", 1, { table: 2 })).toBe("M");
  });
});

describe("§D3 ORFs", () => {
  test("table 4 does not cut at TGA → +1 1..27 MKWWKPGF", () => {
    const plus = findOrfs("ATGAAATGGTGAAAACCCGGGTTTTAA", { table: 4 }).filter((o) => o.strand === "+");
    expect(plus.map((o) => `${o.strand}${o.frame} ${o.start}..${o.end} ${o.protein}`)).toEqual(["+1 1..27 MKWWKPGF"]);
  });

  test("table 1 still cuts there (unchanged)", () => {
    const plus = findOrfs("ATGAAATGGTGAAAACCCGGGTTTTAA").filter((o) => o.strand === "+");
    expect(plus[0]).toMatchObject({ start: 1, end: 12, protein: "MKW" });
  });

  test('starts:"table", t11, GTGAAACCCGGGTAA → one ORF 1..15 MKPG', () => {
    const orfs = findOrfs("GTGAAACCCGGGTAA", { table: 11, starts: "table" });
    expect(orfs.map((o) => `${o.strand} ${o.start}..${o.end} ${o.protein}`)).toEqual(["+ 1..15 MKPG"]);
  });

  test('starts default "ATG" → [] as today', () => {
    expect(findOrfs("GTGAAACCCGGGTAA", { table: 11 })).toEqual([]);
    expect(findOrfs("GTGAAACCCGGGTAA")).toEqual([]);
  });

  test("tables 27/28/31 are refused by name", () => {
    for (const t of [27, 28, 31]) {
      expect(() => findOrfs("ATGAAATAA", { table: t })).toThrow(GeneticCodeError);
      expect(() => findOrfs("ATGAAATAA", { table: t })).toThrow(new RegExp(`table ${t}`));
    }
  });

  test("the ORF caption names the table and the start rule; no info → unchanged HTML", () => {
    const orfs = findOrfs("GTGAAACCCGGGTAA", { table: 11, starts: "table" });
    expect(orfSearchCaption({ table: 11, starts: "table" })).toBe(
      "Genetic code: NCBI table 11 (Bacterial, Archaeal and Plant Plastid) · starts: ATG and alternative initiation " +
        "codons (TTG, CTG, ATT, ATC, ATA, ATG, GTG), each read as M",
    );
    expect(buildOrfTableHtml(orfs, { table: 11, starts: "table" })).toMatch(/^<p>Genetic code: NCBI table 11/);
    expect(buildOrfTableHtml(orfs)).toMatch(/^<table/);
    expect(orfSearchCaption()).toBe("Genetic code: NCBI table 1 (Standard) · starts: ATG only");
  });
});

describe("§D3 degenerate codons", () => {
  test.each([
    ["TRA", 2, "X"], ["TRA", 1, "*"], ["AGR", 2, "*"], ["AGR", 1, "R"], ["TGR", 1, "X"], ["TGR", 2, "W"],
  ])("resolveCodon(%s, %i) → %s", (codon, table, aa) => {
    expect(resolveCodon(codon, table)).toBe(aa);
  });

  test("resolveCodon defaults to table 1 and refuses an unknown table by name", () => {
    expect(resolveCodon("TGA")).toBe("*");
    expect(() => resolveCodon("TGA", 7)).toThrow(/merged in code id 4/);
  });
});
