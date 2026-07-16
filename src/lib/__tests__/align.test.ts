// Pairwise alignment — BLOSUM62 integrity and Gotoh correctness.
//
// The BLOSUM62 matrix in align.ts is TRANSCRIBED DATA, which is exactly the class
// this project keeps getting burnt by: a single wrong cell would skew every protein
// alignment silently, and no crash would ever announce it. So it is checked against
// the published matrix's own structural properties rather than trusted.
//
// The aligner is checked the strongest way available offline: the score reported by
// the dynamic program is RE-DERIVED from the traceback it produced. If the DP and
// the traceback disagree — the classic way an alignment implementation is wrong —
// the two numbers diverge and the test fails. That check needs no external tool and
// cannot be satisfied by a plausible-looking wrong alignment.

import { align, blosum62, BLOSUM62, guessKind, cleanSequence, formatAlignment } from "../align";

describe("BLOSUM62 is the real matrix, not an approximation of one", () => {
  const { order, rows } = BLOSUM62;

  test("it is square and covers the 20 residues plus B, Z, X, *", () => {
    expect(order).toHaveLength(24);
    expect(rows).toHaveLength(24);
    for (const r of rows) expect(r).toHaveLength(24);
    for (const aa of "ARNDCQEGHILKMFPSTWYV") expect(order).toContain(aa);
  });

  test("it is SYMMETRIC — a substitution matrix must be", () => {
    // The single most powerful structural check: a transcription slip almost always
    // breaks symmetry.
    const bad: string[] = [];
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        if (rows[i][j] !== rows[j][i]) bad.push(`${order[i]}/${order[j]}: ${rows[i][j]} vs ${rows[j][i]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("every value is inside the published range [-4, 11]", () => {
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        expect(rows[i][j]).toBeGreaterThanOrEqual(-4);
        expect(rows[i][j]).toBeLessThanOrEqual(11);
      }
    }
  });

  test("the diagonal matches the published self-scores", () => {
    // Rare residues score highest against themselves — W is the famous 11.
    const diag: [string, number][] = [
      ["A", 4], ["R", 5], ["N", 6], ["D", 6], ["C", 9], ["Q", 5], ["E", 5],
      ["G", 6], ["H", 8], ["I", 4], ["L", 4], ["K", 5], ["M", 5], ["F", 6],
      ["P", 7], ["S", 4], ["T", 5], ["W", 11], ["Y", 7], ["V", 4],
    ];
    for (const [aa, v] of diag) expect(blosum62(aa, aa)).toBe(v);
  });

  test("W has the highest self-score of any residue", () => {
    const selves = [..."ARNDCQEGHILKMFPSTWYV"].map((c) => blosum62(c, c));
    expect(Math.max(...selves)).toBe(11);
    expect(blosum62("W", "W")).toBe(11);
  });

  test("conservative substitutions score positive — the matrix's whole purpose", () => {
    for (const [x, y] of [
      ["I", "V"], ["I", "L"], ["L", "M"], ["F", "Y"], ["Y", "W"],
      ["K", "R"], ["D", "E"], ["N", "D"], ["Q", "E"], ["S", "T"], ["S", "A"],
    ] as [string, string][]) {
      expect({ pair: `${x}/${y}`, score: blosum62(x, y) > 0 }).toEqual({ pair: `${x}/${y}`, score: true });
    }
  });

  test("chemically dissimilar substitutions score negative", () => {
    for (const [x, y] of [
      ["W", "P"], ["C", "E"], ["G", "L"], ["D", "F"], ["K", "I"], ["R", "V"],
    ] as [string, string][]) {
      expect({ pair: `${x}/${y}`, score: blosum62(x, y) < 0 }).toEqual({ pair: `${x}/${y}`, score: true });
    }
  });

  test("the stop symbol scores -4 against every residue and +1 with itself", () => {
    for (const aa of "ARNDCQEGHILKMFPSTWYV") expect(blosum62("*", aa)).toBe(-4);
    expect(blosum62("*", "*")).toBe(1);
  });

  test("an unknown character is treated as X, not as a crash or a zero", () => {
    expect(blosum62("J", "A")).toBe(blosum62("X", "A"));
    expect(blosum62("?", "W")).toBe(blosum62("X", "W"));
  });
});

// ---------------------------------------------------------------------------

/** Re-derives an alignment's score from its own columns, independently of the DP. */
function rescore(r: ReturnType<typeof align>, gapOpen = 10, gapExtend = 0.5): number {
  if (!r) throw new Error("no alignment");
  let s = 0;
  let inGapA = false;
  let inGapB = false;
  for (let k = 0; k < r.length; k++) {
    const x = r.a[k];
    const y = r.b[k];
    if (x === "-") {
      s -= inGapA ? gapExtend : gapOpen + gapExtend;
      inGapA = true;
      inGapB = false;
    } else if (y === "-") {
      s -= inGapB ? gapExtend : gapOpen + gapExtend;
      inGapB = true;
      inGapA = false;
    } else {
      s += r.kind === "protein" ? blosum62(x, y) : x === y ? 5 : -4;
      inGapA = false;
      inGapB = false;
    }
  }
  return Math.round(s * 10) / 10;
}

describe("the traceback agrees with the dynamic program", () => {
  // If the DP score and the alignment it emitted disagree, the aligner is wrong —
  // and the alignment would still LOOK perfectly reasonable on screen. This is the
  // check that cannot be fooled by a plausible result.
  const cases: [string, string, string][] = [
    ["identical protein", "MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQISFVKSHFSRQ"],
    ["substitutions only", "MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQVSFVKSHFARQ"],
    ["one internal deletion", "MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQKSHFSRQ"],
    ["one internal insertion", "MKTAYIAKQRQKSHFSRQ", "MKTAYIAKQRQISFVKSHFSRQ"],
    ["terminal truncation", "MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQ"],
    ["very different", "MKTAYIAKQRQISFVKSHFSRQ", "WWWWPPPPCCCC"],
    ["single residue", "A", "A"],
    ["one vs many", "A", "MKTAYIAKQRQ"],
  ];

  test.each(cases)("global: %s", (_label, a, b) => {
    const r = align(a, b, { mode: "global", kind: "protein" });
    expect(r).not.toBeNull();
    expect(rescore(r)).toBeCloseTo(r!.score, 1);
  });

  test.each(cases)("local: %s", (_label, a, b) => {
    const r = align(a, b, { mode: "local", kind: "protein" });
    expect(r).not.toBeNull();
    expect(rescore(r)).toBeCloseTo(r!.score, 1);
  });

  test("DNA alignments also reconcile", () => {
    for (const [a, b] of [
      ["ATGCGTACGTAGCTAGCTAGCAT", "ATGCGTACGTAGCTAGCTAGCAT"],
      ["ATGCGTACGTAGCTAGCTAGCAT", "ATGCGTACGTTGCTAGCTAGCAT"],
      ["ATGCGTACGTAGCTAGCTAGCAT", "ATGCGTACGTAGCAT"],
      ["ATGCGT", "TTTTTT"],
    ]) {
      for (const mode of ["global", "local"] as const) {
        const r = align(a, b, { mode, kind: "dna" });
        expect(rescore(r)).toBeCloseTo(r!.score, 1);
      }
    }
  });
});

describe("alignments are correct in the ways a biologist checks first", () => {
  test("identical sequences align at 100% with no gaps", () => {
    const s = "MKTAYIAKQRQISFVKSHFSRQ";
    const r = align(s, s, { mode: "global" })!;
    expect(r.percentIdentity).toBe(100);
    expect(r.gaps).toBe(0);
    expect(r.a).toBe(s);
    expect(r.b).toBe(s);
    expect(r.ruler).toBe("|".repeat(s.length));
  });

  test("a global alignment spans BOTH sequences entirely", () => {
    const a = "MKTAYIAKQRQISFVKSHFSRQ";
    const b = "MKTAYIAKQRQ";
    const r = align(a, b, { mode: "global" })!;
    expect(r.a.replace(/-/g, "")).toBe(a);
    expect(r.b.replace(/-/g, "")).toBe(b);
    expect(r.a).toHaveLength(r.b.length);
  });

  test("a local alignment finds a shared domain inside unrelated flanks", () => {
    const motif = "HFSRQWKTAYIAKQ";
    const a = `PPPPPPPPPP${motif}PPPPPPPPPP`;
    const b = `WWWWWWWWWW${motif}WWWWWWWWWW`;
    const r = align(a, b, { mode: "local", kind: "protein" })!;
    // It should recover the motif and essentially nothing else.
    expect(r.a).toContain(motif);
    expect(r.b).toContain(motif);
    expect(r.percentIdentity).toBeGreaterThan(90);
    expect(r.length).toBeLessThan(motif.length + 6);
  });

  test("local scores at least as well as global on the same pair", () => {
    // A local alignment can always choose the global one's best subsegment, so it
    // can never score lower. A violation means the DP is broken.
    for (const [a, b] of [
      ["PPPPPPHFSRQWKTAYIAKQPPPPPP", "WWWWWWHFSRQWKTAYIAKQWWWWWW"],
      ["MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQ"],
    ]) {
      const g = align(a, b, { mode: "global", kind: "protein" })!;
      const l = align(a, b, { mode: "local", kind: "protein" })!;
      expect(l.score).toBeGreaterThanOrEqual(g.score);
    }
  });

  test("alignment columns always pair up: same length, originals recoverable", () => {
    const r = align("MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQKSHFSRQ", { mode: "global" })!;
    expect(r.a).toHaveLength(r.b.length);
    expect(r.ruler).toHaveLength(r.a.length);
    // No column may be gap/gap — that is a wasted column and a classic DP bug.
    for (let k = 0; k < r.length; k++) expect(r.a[k] === "-" && r.b[k] === "-").toBe(false);
  });

  test("statistics are self-consistent", () => {
    const r = align("MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQVSFVKSHFARQ", { mode: "global" })!;
    expect(r.identities).toBeLessThanOrEqual(r.similarities);
    expect(r.similarities + r.gaps).toBeLessThanOrEqual(r.length);
    expect(r.percentIdentity).toBeCloseTo((r.identities / r.length) * 100, 1);
  });
});

describe("affine gaps behave like affine gaps", () => {
  test("ONE long gap is preferred over several scattered short ones", () => {
    // The entire reason for Gotoh. With a linear penalty these score the same and
    // the aligner scatters gaps — an alignment no biologist would accept.
    const a = "AAAAAAAAAAGGGGGGGGGGAAAAAAAAAA";
    const b = "AAAAAAAAAAAAAAAAAAAA"; // the G block deleted as one event
    const r = align(a, b, { mode: "global", kind: "dna" })!;
    // Count separate gap runs in the shorter sequence.
    const runs = (r.b.match(/-+/g) ?? []).length;
    expect(runs).toBe(1);
    expect(r.gaps).toBe(10);
  });

  test("a bigger gap-open cost buys fewer, longer gaps", () => {
    const a = "ACGTACGTACGTTTTTACGTACGTACGT";
    const b = "ACGTACGTACGTACGTACGTACGT";
    const cheap = align(a, b, { mode: "global", kind: "dna", gapOpen: 1, gapExtend: 1 })!;
    const dear = align(a, b, { mode: "global", kind: "dna", gapOpen: 50, gapExtend: 0.1 })!;
    const runs = (s: string) => (s.match(/-+/g) ?? []).length;
    expect(runs(dear.b)).toBeLessThanOrEqual(runs(cheap.b));
  });

  test("extending a gap is cheaper than opening a second one", () => {
    const r = align("AAAAGGGGGGAAAA", "AAAAAAAA", { mode: "global", kind: "dna" })!;
    expect(rescore(r)).toBeCloseTo(r.score, 1);
    expect((r.b.match(/-+/g) ?? []).length).toBe(1);
  });
});

describe("input handling refuses to produce nonsense", () => {
  test("empty input returns null rather than an empty 'alignment'", () => {
    expect(align("", "ACGT")).toBeNull();
    expect(align("ACGT", "")).toBeNull();
    expect(align("", "")).toBeNull();
  });

  test("FASTA cruft (whitespace, digits, case) is stripped", () => {
    expect(cleanSequence("  atg cgt\n  60 acgt ")).toBe("ATGCGTACGT");
  });

  test("kind detection is conservative — a protein is never aligned as DNA", () => {
    expect(guessKind("ATGCGTACGTAGCTAGCTAGCAT")).toBe("dna");
    expect(guessKind("AUGCGUACGUAGCUAGCUAGCAU")).toBe("dna");
    expect(guessKind("MKTAYIAKQRQISFVKSHFSRQ")).toBe("protein");
    // Ala/Cys/Gly/Thr-rich peptide: mostly DNA letters, but it is a protein.
    expect(guessKind("ACGTACGTWWPPHH")).toBe("protein");
  });

  test("U aligns to T so RNA can be compared with DNA", () => {
    const r = align("AUGCGUACGU", "ATGCGTACGT", { mode: "global", kind: "dna" })!;
    expect(r.percentIdentity).toBe(100);
  });

  test("N is neither rewarded nor penalised", () => {
    const r = align("ATGCNNNNGT", "ATGCACGTGT", { mode: "global", kind: "dna" })!;
    expect(r.gaps).toBe(0);
    expect(r.length).toBe(10);
  });
});

describe("caveats state what the numbers do not", () => {
  test("global and local each explain their own failure mode", () => {
    const g = align("MKTAYIAKQRQ", "MKTAYIAKQRQ", { mode: "global" })!;
    expect(g.caveats.join(" ")).toMatch(/forces an end-to-end alignment/);
    const l = align("MKTAYIAKQRQ", "MKTAYIAKQRQ", { mode: "local" })!;
    expect(l.caveats.join(" ")).toMatch(/single best-scoring subsegment/);
  });

  test("the twilight zone is called out when identity is below ~25%", () => {
    const r = align("MKTAYIAKQRQISFVKSHFSRQ", "WWPPCCWWPPCCWWPPCCWWPP", { mode: "global", kind: "protein" })!;
    if (r.percentIdentity < 25) expect(r.caveats.join(" ")).toMatch(/twilight zone/);
  });

  test("a high-identity alignment does NOT get the twilight warning", () => {
    const s = "MKTAYIAKQRQISFVKSHFSRQ";
    expect(align(s, s, { mode: "global" })!.caveats.join(" ")).not.toMatch(/twilight zone/);
  });

  test("every alignment names its scoring parameters", () => {
    expect(align("MKTA", "MKTA", { kind: "protein" })!.caveats.join(" ")).toMatch(/BLOSUM62/);
    expect(align("ATGC", "ATGC", { kind: "dna" })!.caveats.join(" ")).toMatch(/Match 5 \/ mismatch -4/);
  });
});

describe("the rendered block is the layout a biologist expects", () => {
  test("coordinates track the residues consumed on each line", () => {
    const a = "MKTAYIAKQRQISFVKSHFSRQMKTAYIAKQRQISFVKSHFSRQMKTAYIAKQRQISFVKSHFSRQ";
    const r = align(a, a, { mode: "global" })!;
    const txt = formatAlignment(r, 30, "query", "sbjct");
    const lines = txt.split("\n").filter((l) => l.startsWith("query"));
    expect(lines[0]).toMatch(/query\s+1\s+\S+\s+30$/);
    expect(lines[1]).toMatch(/query\s+31\s+\S+\s+60$/);
  });

  test("the ruler line sits between the two sequence lines", () => {
    const r = align("MKTAYIAKQRQ", "MKTAYIAKQRQ", { mode: "global" })!;
    const lines = formatAlignment(r, 60, "A", "B").split("\n");
    expect(lines[0]).toContain("MKTAYIAKQRQ");
    expect(lines[1]).toContain("|||||||||||");
    expect(lines[2]).toContain("MKTAYIAKQRQ");
  });
});
