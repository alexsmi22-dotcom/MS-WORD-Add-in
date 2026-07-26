// Regression: FASTA headers were folded into the sequence.
//
// Both Align and DNA mode invite a FASTA paste — taskpane.html:715 promises
// "headers, line numbers and whitespace are stripped" — but cleanSequence() and
// cleanDna() stripped only NON-letters, so every letter in the header survived
// into the sequence. Measured before the fix on two real ACTB orthologue
// fragments: 96.5% identity became 86.4%, and guessKind() flipped from "dna" to
// "protein", so a nucleotide pair was scored with BLOSUM62.
//
// The damage was invisible: the alignment still rendered, still reported a
// percent identity, and DNA mode's "ignored invalid characters" line made the
// header look handled because its non-IUPAC letters were listed there.

import { cleanSequence, guessKind, countFastaRecords, align } from "../align";
import { cleanDna, baseStats } from "../dna";

const HEADER = ">gi|5453555|ref|NM_001101.3| Homo sapiens actin beta ACTB mRNA";
const SEQ = "ATGGATGATGATATCGCCGCG";

describe("align — FASTA headers never reach the sequence", () => {
  test("a header contributes no residues", () => {
    expect(cleanSequence(`${HEADER}\n${SEQ}`)).toBe(SEQ);
  });

  test("pasting FASTA gives the same result as pasting the bare sequence", () => {
    expect(cleanSequence(`${HEADER}\n${SEQ}`)).toBe(cleanSequence(SEQ));
  });

  test("the header no longer flips the sequence type to protein", () => {
    // This is the part that silently changed the scoring matrix.
    expect(guessKind(SEQ)).toBe("dna");
    expect(guessKind(`${HEADER}\n${SEQ}`)).toBe("dna");
  });

  test("wrapped multi-line FASTA is joined correctly", () => {
    const wrapped = `${HEADER}\nATGGATGATGAT\nATCGCCGCG`;
    expect(cleanSequence(wrapped)).toBe(SEQ);
  });

  test("legacy ';' comment lines are dropped too", () => {
    expect(cleanSequence(`; a legacy comment\n${SEQ}`)).toBe(SEQ);
  });

  test("a '>' inside a line is not treated as a header", () => {
    // Only a line-leading ">" starts a FASTA record.
    expect(cleanSequence("ACGT>ACGT")).toBe("ACGTACGT");
  });

  test("aligning two FASTA-pasted sequences matches aligning the bare ones", () => {
    const a = "ATGGATGATGATATCGCCGCGCTGGTCGTCGAC";
    const b = "ATGGATGATGATATCGCCGCGTTGGTCGTCGAC";
    const bare = align(a, b, { mode: "global" });
    const fasta = align(`${HEADER}\n${a}`, `>another header here\n${b}`, { mode: "global" });
    expect(bare).not.toBeNull();
    expect(fasta).not.toBeNull();
    expect(fasta!.kind).toBe(bare!.kind);
    expect(fasta!.percentIdentity).toBeCloseTo(bare!.percentIdentity, 10);
    expect(fasta!.score).toBe(bare!.score);
    expect(fasta!.length).toBe(bare!.length);
  });

  test("countFastaRecords sees a multi-record paste", () => {
    expect(countFastaRecords(SEQ)).toBe(0);
    expect(countFastaRecords(`${HEADER}\n${SEQ}`)).toBe(1);
    expect(countFastaRecords(`${HEADER}\n${SEQ}\n>second\n${SEQ}`)).toBe(2);
  });
});

describe("dna — FASTA headers never reach the sequence", () => {
  test("a header contributes no bases", () => {
    const r = cleanDna(`${HEADER}\n${SEQ}`);
    expect(r.seq).toBe(SEQ);
  });

  test("GC% is unaffected by the header", () => {
    const bare = baseStats(cleanDna(SEQ).seq);
    const withHeader = baseStats(cleanDna(`${HEADER}\n${SEQ}`).seq);
    expect(withHeader.gcPercent).toBeCloseTo(bare.gcPercent, 10);
    expect(withHeader.length).toBe(bare.length);
  });

  test("header letters are not reported as invalid characters either", () => {
    // Before the fix the non-IUPAC header letters showed up here, which made the
    // header look like it had been dealt with.
    expect(cleanDna(`${HEADER}\n${SEQ}`).invalid).toEqual([]);
  });

  test("genuinely invalid bases are still reported", () => {
    const r = cleanDna("ACGTZZQ");
    expect(r.seq).toBe("ACGT");
    expect(r.invalid.sort()).toEqual(["Q", "Z"]);
  });

  test("a multi-record paste is counted so the UI can warn", () => {
    expect(cleanDna(SEQ).records).toBe(0);
    expect(cleanDna(`${HEADER}\n${SEQ}`).records).toBe(1);
    expect(cleanDna(`${HEADER}\n${SEQ}\n>second\n${SEQ}`).records).toBe(2);
  });
});
