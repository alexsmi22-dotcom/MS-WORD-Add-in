// Adversarial pass on geneticCode.ts and its wiring (dna.ts, sequence.ts).
//
// INDEPENDENT ORACLE. BIO below is a second copy of all 27 NCBI tables in a
// DIFFERENT representation from geneticCode.ts's 64-character gc.prt strings:
// Biopython 1.88 `Bio.Data.CodonTable.unambiguous_dna_by_id[t]`, dumped as
// amino acid → sorted codon list, plus Biopython's own start_codons /
// stop_codons. (Biopython's stop list = our hard stops + context stops; its
// forward table includes the SENSE reading of context stops, as ncbieaa does.)
// Every one of the 27 × 64 cells, every start and every stop is compared.

import { GENETIC_CODES, geneticCodeById, GeneticCodeError, ncbiCodonAt } from "../geneticCode";
import { findOrfs, resolveCodon, translate, translateReport } from "../dna";
import { buildSt26Xml, featureNotes, featureWarnings, type SequenceEntry } from "../sequence";

type BioTable = { aa: Record<string, string>; starts: string; stops: string };
const BIO: Record<number, BioTable> = {
  1: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG CTG TTG", stops: "TAA TAG TGA" },
  2: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATA ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATA ATC ATG ATT GTG", stops: "AGA AGG TAA TAG" },
  3: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATC ATT", K: "AAA AAG", L: "TTA TTG", M: "ATA ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT CTA CTC CTG CTT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATA ATG GTG", stops: "TAA TAG" },
  4: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATA ATC ATG ATT CTG GTG TTA TTG", stops: "TAA TAG" },
  5: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATA ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGA AGC AGG AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATA ATC ATG ATT GTG TTG", stops: "TAA TAG" },
  6: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG TAA TAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TGA" },
  9: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAA AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGA AGC AGG AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATG GTG", stops: "TAA TAG" },
  10: { aa: { A: "GCA GCC GCG GCT", C: "TGA TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TAA TAG" },
  11: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATA ATC ATG ATT CTG GTG TTG", stops: "TAA TAG TGA" },
  12: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT CTG TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG CTG", stops: "TAA TAG TGA" },
  13: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "AGA AGG GGA GGC GGG GGT", H: "CAC CAT", I: "ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATA ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATA ATG GTG TTG", stops: "TAA TAG" },
  14: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAA AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGA AGC AGG AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAA TAC TAT" },
    starts: "ATG", stops: "TAG" },
  15: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG TAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TAA TGA" },
  16: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TAG TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TAA TGA" },
  21: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATC ATT", K: "AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATA ATG", N: "AAA AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGA AGC AGG AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATG GTG", stops: "TAA TAG" },
  22: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TAG TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TAA TCA TGA" },
  23: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG ATT GTG", stops: "TAA TAG TGA TTA" },
  24: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG AGG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGA AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATG CTG GTG TTG", stops: "TAA TAG" },
  25: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT TGA", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG GTG TTG", stops: "TAA TAG" },
  26: { aa: { A: "CTG GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG CTG", stops: "TAA TAG TGA" },
  27: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG TAA TAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TGA" },
  28: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG TAA TAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TAA TAG TGA" },
  29: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAA TAC TAG TAT" },
    starts: "ATG", stops: "TGA" },
  30: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG TAA TAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TGA" },
  31: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG TAA TAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAC TAT" },
    starts: "ATG", stops: "TAA TAG" },
  32: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "AGA AGG CGA CGC CGG CGT", S: "AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TAG TGG", Y: "TAC TAT" },
    starts: "ATA ATC ATG ATT CTG GTG TTG", stops: "TAA TGA" },
  33: { aa: { A: "GCA GCC GCG GCT", C: "TGC TGT", D: "GAC GAT", E: "GAA GAG", F: "TTC TTT", G: "GGA GGC GGG GGT", H: "CAC CAT", I: "ATA ATC ATT", K: "AAA AAG AGG", L: "CTA CTC CTG CTT TTA TTG", M: "ATG", N: "AAC AAT", P: "CCA CCC CCG CCT", Q: "CAA CAG", R: "CGA CGC CGG CGT", S: "AGA AGC AGT TCA TCC TCG TCT", T: "ACA ACC ACG ACT", V: "GTA GTC GTG GTT", W: "TGA TGG", Y: "TAA TAC TAT" },
    starts: "ATG CTG GTG TTG", stops: "TAG" },
};

const ALL_CODONS = Array.from({ length: 64 }, (_, i) => ncbiCodonAt(i));
const sorted = (xs: readonly string[]): string[] => xs.slice().sort();

describe("all 27 tables vs the independent Biopython copy, cell by cell", () => {
  test("same set of ids", () => {
    expect(GENETIC_CODES.map((c) => c.id)).toEqual(Object.keys(BIO).map(Number));
  });

  for (const code of GENETIC_CODES) {
    test(`table ${code.id}: 64 cells, starts, stops`, () => {
      const bio = BIO[code.id];
      // Invert Biopython's aa → codons into codon → aa.
      const bioMap: Record<string, string> = {};
      for (const [aa, codons] of Object.entries(bio.aa)) {
        for (const c of codons.split(" ")) {
          expect(bioMap[c]).toBeUndefined(); // the oracle itself must be a function
          bioMap[c] = aa;
        }
      }
      const bioStops = bio.stops.split(" ");
      let checked = 0;
      for (const codon of ALL_CODONS) {
        const ours = code.codons[codon];
        // Biopython's forward table omits HARD stops only.
        const expected = bioMap[codon] ?? (bioStops.indexOf(codon) >= 0 ? "*" : "?");
        expect(`${codon}=${ours}`).toBe(`${codon}=${expected}`);
        // ...and resolveCodon agrees with the table on every concrete codon.
        expect(resolveCodon(codon, code.id)).toBe(ours);
        checked++;
      }
      expect(checked).toBe(64);
      expect(sorted(code.starts)).toEqual(sorted(bio.starts.split(" ")));
      expect(sorted([...code.stops, ...code.contextStops])).toEqual(sorted(bioStops));
      // Context stops are exactly the Biopython stops that ALSO have a sense reading.
      expect(sorted(code.contextStops)).toEqual(sorted(bioStops.filter((s) => bioMap[s] !== undefined)));
    });
  }
});

describe("alternative starts in every table", () => {
  for (const code of GENETIC_CODES) {
    test(`table ${code.id}: each start codon → M with the initiator rule, its own residue without`, () => {
      for (const start of code.starts) {
        // AAG, not AAA: AAA is Asn in tables 9, 14 and 21.
        const seq = start + "AAGCCC";
        expect(translate(seq, { table: code.id, initiator: true })).toBe("MKP");
        expect(translate(seq, { table: code.id })).toBe(code.codons[start] + "KP");
        // RNA and lowercase input behave identically.
        expect(translate(seq.toLowerCase().replace(/t/g, "u"), { table: code.id, initiator: true })).toBe("MKP");
      }
      // A non-start first codon is never promoted.
      const nonStart = ALL_CODONS.find((c) => code.starts.indexOf(c) < 0 && code.codons[c] !== "*" && code.codons[c] !== "M")!;
      expect(translate(nonStart + "AAG", { table: code.id, initiator: true })).toBe(code.codons[nonStart] + "K");
    });

    if (!code.contextStops.length) {
      test(`table ${code.id}: starts:"table" finds an ORF from every start codon, reading it as M`, () => {
        const stop = code.stops[0];
        for (const start of code.starts) {
          const plus = findOrfs(start + "AAGCCC" + stop, { table: code.id, starts: "table", includeReverse: false });
          expect(plus.map((o) => o.protein)).toEqual(["MKP"]);
        }
      });
    }
  }

  test("the initiator rule fires only on the FIRST codon", () => {
    expect(translate("AAAGTGCCC", { table: 11, initiator: true })).toBe("KVP");
  });

  test("the initiator rule does not apply in frame 2 or 3, and the report says so", () => {
    expect(translate("AGTGAAACCC", { table: 11, initiator: true, frame: 2 })).toBe("VKP");
    expect(translateReport("AGTGAAACCC", { table: 11, initiator: true, frame: 2 }).notes.join(" ")).toMatch(/frame 1/);
  });

  test("a degenerate first codon is M only when EVERY expansion is a start", () => {
    // ATH = ATA/ATC/ATT: all table-2 starts.
    expect(translate("ATHAAA", { table: 2, initiator: true })).toBe("MK");
    // NTG = ATG/CTG/GTG/TTG: GTG is not a table-1 start → not promoted; mixed → X.
    expect(translate("NTGAAA", { table: 1, initiator: true })).toBe("XK");
    // ...but under table 11 all four are starts.
    expect(translate("NTGAAA", { table: 11, initiator: true })).toBe("MK");
  });
});

describe("stop-codon reassignments", () => {
  test("table 2: AGA/AGG stop, TGA is Trp", () => {
    expect(translate("AGAAGGTGA", { table: 2 })).toBe("**W");
    expect(translate("ATGAAAAGACCC", { table: 2, stopAtStop: true })).toBe("MK");
    const plus = findOrfs("ATGAAAAGG", { table: 2, includeReverse: false });
    expect(plus).toEqual([expect.objectContaining({ start: 1, end: 9, protein: "MK" })]);
    // TGA does not end a table-2 ORF.
    expect(findOrfs("ATGTGAAAATAA", { table: 2, includeReverse: false }).map((o) => o.protein)).toEqual(["MWK"]);
  });

  test("table 6: TAA/TAG are Gln, only TGA stops", () => {
    expect(translate("TAATAGTGA", { table: 6 })).toBe("QQ*");
    expect(findOrfs("ATGTAATAGTGA", { table: 6, includeReverse: false }).map((o) => o.protein)).toEqual(["MQQ"]);
  });

  test("table 22: TCA is a stop", () => {
    expect(findOrfs("ATGAAATCA", { table: 22, includeReverse: false }).map((o) => o.protein)).toEqual(["MK"]);
  });

  test("table 23: TTA is a stop", () => {
    expect(translate("ATGTTAAAA", { table: 23 })).toBe("M*K");
  });
});

describe("frame shifts", () => {
  const seq = "CATGAGATGATGGTAA"; // the §D3 sequence behind one extra base
  test("frame 2 under each table = frame 1 of the unshifted sequence", () => {
    for (const t of [1, 2, 3, 4, 5, 11]) {
      expect(translate(seq, { table: t, frame: 2 })).toBe(translate(seq.slice(1), { table: t }));
    }
    expect(translate(seq, { table: 2, frame: 2 })).toBe("M*WW*");
  });
  test("frame 3", () => {
    expect(translate("GG" + "ATGTGA", { table: 4, frame: 3 })).toBe("MW");
  });
});

describe("lowercase, RNA and IUPAC input", () => {
  test("lowercase RNA = uppercase DNA under every table", () => {
    const dna = "ATGAGATGATGGTAAAGGCTGTTAATATGA";
    const rna = dna.toLowerCase().replace(/t/g, "u");
    for (const code of GENETIC_CODES) expect(translate(rna, { table: code.id })).toBe(translate(dna, { table: code.id }));
  });

  test("ambiguous bases translate to X when expansions disagree, resolved when they agree — per table", () => {
    // TGR: TGA/TGG → */W in table 1 (X), W/W in table 2 (W).
    expect(translate("TGR", { table: 1 })).toBe("X");
    expect(translate("TGR", { table: 2 })).toBe("W");
    // CTN: Leu in table 1, Thr in table 3, mixed (L, S) in table 12 → X.
    expect(translate("CTN", { table: 1 })).toBe("L");
    expect(translate("CTN", { table: 3 })).toBe("T");
    expect(translate("CTN", { table: 12 })).toBe("X");
    // Non-IUPAC letters → X, never a guess.
    expect(translate("ZZZ", { table: 2 })).toBe("X");
  });

  test("findOrfs counts a degenerate codon as a stop only when every expansion is one", () => {
    // TAR = TAA/TAG: stops in table 1, Gln in table 6.
    expect(findOrfs("ATGAAATAR", { includeReverse: false }).map((o) => o.protein)).toEqual(["MK"]);
    expect(findOrfs("ATGAAATARTGA", { table: 6, includeReverse: false }).map((o) => o.protein)).toEqual(["MKQ"]);
  });
});

describe("unknown tables are refused by name everywhere", () => {
  test.each([7, 8, 0, 17, 20, 34, 1.5, NaN])("table %p", (t) => {
    expect(() => translate("ATG", { table: t })).toThrow(GeneticCodeError);
    expect(() => resolveCodon("ATG", t)).toThrow(GeneticCodeError);
    expect(() => findOrfs("ATGTAA", { table: t })).toThrow(GeneticCodeError);
    expect(() => geneticCodeById(t)).toThrow(/NCBI/);
  });
});

describe("ST.26 /transl_table junk values", () => {
  const META = { applicantName: "A", inventionTitle: "T", productionDate: "2026-10-14" };
  const entry = (value: string | string[]): SequenceEntry => ({
    moltype: "DNA",
    residues: "GTGAAACCCTAA",
    features: [{
      key: "CDS",
      location: "1..12",
      qualifiers: (Array.isArray(value) ? value : [value]).map((v) => ({ name: "transl_table", value: v })),
    }],
  });
  const tr = (xml: string): string | null =>
    /<INSDQualifier_name>translation<\/INSDQualifier_name><INSDQualifier_value>([^<]*)</.exec(xml)?.[1] ?? null;

  test.each(["2a", "02", "-1", "2.0", "0", "0x2", "eleven", "7", "8", "17", "99999", "27", "31"])(
    "%p → no /translation AND a warning (never one without the other)",
    (v) => {
      const e = entry(v);
      expect(tr(buildSt26Xml(META, [e]))).toBeNull();
      expect(featureWarnings(e).join(" ")).toMatch(/no \/translation was generated/);
    },
  );

  test("whitespace around a valid value is fine", () => {
    expect(tr(buildSt26Xml(META, [entry(" 11 ")]))).toBe("MKP");
    expect(featureWarnings(entry(" 11 "))).toEqual([]);
  });

  test("an empty value is treated as absent (it is dropped from the XML too) → table 1, no initiator", () => {
    const xml = buildSt26Xml(META, [entry("")]);
    expect(tr(xml)).toBe("VKP");
    expect(xml).not.toMatch(/transl_table/);
    expect(featureWarnings(entry(""))).toEqual([]);
  });

  test("conflicting values are refused; repeated equal values are fine", () => {
    expect(tr(buildSt26Xml(META, [entry(["11", "2"])]))).toBeNull();
    expect(featureWarnings(entry(["11", "2"])).join(" ")).toMatch(/conflicting/);
    expect(tr(buildSt26Xml(META, [entry(["11", "11"])]))).toBe("MKP");
  });

  test("codon_start 2 never gets the initiator rule (5′-partial CDS)", () => {
    const e: SequenceEntry = {
      moltype: "DNA",
      residues: "AGTGAAACCCTAA",
      features: [{ key: "CDS", location: "1..13", qualifiers: [{ name: "transl_table", value: "11" }, { name: "codon_start", value: "2" }] }],
    };
    expect(tr(buildSt26Xml(META, [e]))).toBe("VKP");
  });

  test("a drafter-supplied /translation is never overwritten, even under a bad table", () => {
    const e: SequenceEntry = {
      moltype: "DNA",
      residues: "GTGAAACCCTAA",
      features: [{ key: "CDS", location: "1..12", qualifiers: [{ name: "transl_table", value: "7" }, { name: "translation", value: "MKP" }] }],
    };
    expect(tr(buildSt26Xml(META, [e]))).toBe("MKP");
    expect(featureWarnings(e).join(" ")).toMatch(/kept as typed/);
  });

  test("DNA mode and the listing share ONE initiator rule (degenerate first codon, Biopython cds=True)", () => {
    const mk = (residues: string, t: string): SequenceEntry => ({
      moltype: "DNA",
      residues,
      features: [{ key: "CDS", location: `1..${residues.length}`, qualifiers: [{ name: "transl_table", value: t }] }],
    });
    // Biopython: ATHAAACCCTAA t2 → MKP; NTGAAACCCTAA t11 → MKP.
    expect(tr(buildSt26Xml(META, [mk("ATHAAACCCTAA", "2")]))).toBe("MKP");
    expect(translate("ATHAAACCCTAA", { table: 2, initiator: true, stopAtStop: true })).toBe("MKP");
    expect(tr(buildSt26Xml(META, [mk("NTGAAACCCTAA", "11")]))).toBe("MKP");
    expect(tr(buildSt26Xml(META, [mk("NTGAAACCCTAA", "1")]))).toBe("XKP");
    expect(translate("NTGAAACCCTAA", { table: 1, initiator: true, stopAtStop: true })).toBe("XKP");
  });

  test("featureNotes never claims a /translation the XML does not carry", () => {
    const e = (residues: string): SequenceEntry => ({
      moltype: "DNA",
      residues,
      // A natural organism, so the ST.26 ¶84(a) synthetic-construct mol_type note does not appear.
      organism: "Escherichia coli",
      features: [{ key: "CDS", location: `1..${residues.length}`, qualifiers: [{ name: "transl_table", value: "11" }] }],
    });
    for (const r of ["TAAAAACCC", "AT"]) {
      expect(tr(buildSt26Xml(META, [e(r)]))).toBeNull();
      expect(featureNotes(e(r))).toEqual([]);
    }
    expect(featureNotes(e("ATGAAATAA"))).toEqual(["CDS (1..9): /translation generated with NCBI table 11 (Bacterial, Archaeal and Plant Plastid)."]);
  });

  // /transl_except (INSDC: "(pos:location,aa:<amino_acid>)" — a single codon whose
  // translation does not follow the genetic code; aa:TERM = stop) is applied LAST.
  const withExcept = (residues: string, quals: Array<[string, string]>): SequenceEntry => ({
    moltype: "DNA",
    residues,
    features: [{ key: "CDS", location: `1..${residues.length}`, qualifiers: quals.map(([name, value]) => ({ name, value })) }],
  });

  test("/transl_except beats the initiator rule: (pos:1..3,aa:Val) under table 11 → VKPG", () => {
    const e = withExcept("GTGAAACCCGGGTAA", [["transl_table", "11"], ["transl_except", "(pos:1..3,aa:Val)"]]);
    expect(tr(buildSt26Xml(META, [e]))).toBe("VKPG");
    expect(featureNotes(e).join(" ")).not.toMatch(/initiator rule/);
    // ...and without it, the initiator rule still applies.
    expect(tr(buildSt26Xml(META, [withExcept("GTGAAACCCGGGTAA", [["transl_table", "11"]])]))).toBe("MKPG");
  });

  test("/transl_except at a stop codon replaces the stop: Sec → U, Pyl → O, translation continues", () => {
    expect(tr(buildSt26Xml(META, [withExcept("ATGAAATGACCCTAA", [["transl_except", "(pos:7..9,aa:Sec)"]])]))).toBe("MKUP");
    expect(tr(buildSt26Xml(META, [withExcept("ATGAAATAGCCCTAA", [["transl_except", "(pos:7..9,aa:Pyl)"]])]))).toBe("MKOP");
    // Under table 11 too (TGA is a stop there).
    expect(tr(buildSt26Xml(META, [withExcept("ATGAAATGACCCTAA", [["transl_table", "11"], ["transl_except", "(pos:7..9,aa:Sec)"]])]))).toBe("MKUP");
  });

  test("aa:TERM makes a stop; absolute coordinates honour the CDS start and codon_start", () => {
    // aa:TERM at codon 3 of 5 is an internal stop: no auto /translation (bioFixes2193 item 9; was "MK").
    expect(tr(buildSt26Xml(META, [withExcept("ATGAAACCCGGGTAA", [["transl_except", "(pos:7..9,aa:TERM)"]])]))).toBeNull();
    expect(tr(buildSt26Xml(META, [withExcept("ATGAAACCCGGG", [["transl_except", "(pos:10..12,aa:TERM)"]])]))).toBe("MKP");
    const e: SequenceEntry = {
      moltype: "DNA",
      residues: "CCATGAAATGACCCTAA",
      features: [{ key: "CDS", location: "3..17", qualifiers: [{ name: "transl_except", value: "(pos:9..11,aa:Sec)" }] }],
    };
    expect(tr(buildSt26Xml(META, [e]))).toBe("MKUP");
  });

  test.each(["(pos:8..10,aa:Sec)", "(pos:7..8,aa:Sec)", "(pos:7..9,aa:Foo)", "(pos:complement(7..9),aa:Sec)", "(pos:40..42,aa:Sec)", "junk"])(
    "unusable /transl_except %p → no /translation AND a warning",
    (v) => {
      const e = withExcept("ATGAAATGACCCTAA", [["transl_except", v]]);
      expect(tr(buildSt26Xml(META, [e]))).toBeNull();
      expect(featureWarnings(e).join(" ")).toMatch(/transl_except/);
    },
  );

  test("no /transl_except → output unchanged", () => {
    // TGA at codon 3 with no exception is an internal stop: no /translation (bioFixes2193 item 9; was "MK").
    expect(tr(buildSt26Xml(META, [withExcept("ATGAAATGACCCTAA", [])]))).toBeNull();
    expect(featureWarnings(withExcept("ATGAAATGACCCTAA", [])).join(" ")).toMatch(/in-frame stop codon TGA at bases 7\.\.9/);
  });

  test("RNA CDS under table 2", () => {
    const e: SequenceEntry = {
      moltype: "RNA",
      residues: "AUGAGAUGAUGGAAACCCUAA",
      features: [{ key: "CDS", location: "1..21", qualifiers: [{ name: "transl_table", value: "2" }] }],
    };
    // AGA is a table-2 stop at codon 2 of 7: internal stop, no /translation (bioFixes2193 item 9; was "M").
    expect(tr(buildSt26Xml(META, [e]))).toBeNull();
    // Without the internal stop, the RNA (written with t, ST.26 ¶14) still translates under table 2: AUA → M.
    const ok: SequenceEntry = { ...e, residues: "AUGAUAUGGUAA", features: [{ key: "CDS", location: "1..12", qualifiers: [{ name: "transl_table", value: "2" }] }] };
    expect(tr(buildSt26Xml(META, [ok]))).toBe("MMW");
  });
});
