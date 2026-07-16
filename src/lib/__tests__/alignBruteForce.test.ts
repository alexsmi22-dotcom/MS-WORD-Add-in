// Is the alignment actually OPTIMAL, or merely self-consistent?
//
// align.test.ts proves the traceback agrees with the dynamic program. That catches
// a broken traceback but NOT a wrong recurrence: a DP with a subtly wrong gap rule
// is perfectly self-consistent and still returns the wrong alignment. Nothing in
// the output would look odd.
//
// So this file computes the true optimum by EXHAUSTIVE ENUMERATION of every
// possible alignment of two short sequences, using a scorer written independently
// of align.ts, and demands that Gotoh match it exactly. Brute force is O(3^n) so it
// only runs on tiny inputs — which is exactly where a recurrence bug shows up.

import { align, blosum62 } from "../align";

const GAP_OPEN = 10;
const GAP_EXTEND = 0.5;

/** Score a candidate alignment from first principles. Deliberately naive. */
function scoreAlignment(a: string, b: string, kind: "protein" | "dna"): number {
  let s = 0;
  let prev: "" | "gapA" | "gapB" | "match" = "";
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === "-" && y === "-") return -Infinity; // meaningless column
    if (x === "-") {
      s -= prev === "gapA" ? GAP_EXTEND : GAP_OPEN + GAP_EXTEND;
      prev = "gapA";
    } else if (y === "-") {
      s -= prev === "gapB" ? GAP_EXTEND : GAP_OPEN + GAP_EXTEND;
      prev = "gapB";
    } else {
      s += kind === "protein" ? blosum62(x, y) : x === y ? 5 : -4;
      prev = "match";
    }
  }
  return s;
}

/** Every global alignment of a and b, by recursive enumeration. */
function* allGlobal(a: string, b: string, ai = 0, bi = 0, accA = "", accB = ""): Generator<[string, string]> {
  if (ai === a.length && bi === b.length) {
    yield [accA, accB];
    return;
  }
  if (ai < a.length && bi < b.length) yield* allGlobal(a, b, ai + 1, bi + 1, accA + a[ai], accB + b[bi]);
  if (ai < a.length) yield* allGlobal(a, b, ai + 1, bi, accA + a[ai], accB + "-");
  if (bi < b.length) yield* allGlobal(a, b, ai, bi + 1, accA + "-", accB + b[bi]);
}

function bruteForceGlobal(a: string, b: string, kind: "protein" | "dna"): number {
  let best = -Infinity;
  for (const [x, y] of allGlobal(a, b)) {
    const s = scoreAlignment(x, y, kind);
    if (s > best) best = s;
  }
  return Math.round(best * 10) / 10;
}

/** Best local alignment = best global over every pair of substrings, floored at 0. */
function bruteForceLocal(a: string, b: string, kind: "protein" | "dna"): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j <= a.length; j++) {
      for (let k = 0; k < b.length; k++) {
        for (let l = k + 1; l <= b.length; l++) {
          const s = bruteForceGlobal(a.slice(i, j), b.slice(k, l), kind);
          if (s > best) best = s;
        }
      }
    }
  }
  return Math.round(best * 10) / 10;
}

describe("Gotoh finds the true optimum (brute-forced)", () => {
  const PROTEIN: [string, string][] = [
    ["MKTA", "MKTA"],
    ["MKTA", "MKA"],
    ["MKTA", "MTA"],
    ["MKTA", "WPCG"],
    ["MKT", "MKTAY"],
    ["WW", "W"],
    ["MKTAY", "MKAY"],
    ["ILV", "LIV"],
    ["A", "MKTA"],
    ["MKTAY", "YATKM"],
  ];

  test.each(PROTEIN)("global protein: %s vs %s", (a, b) => {
    const dp = align(a, b, { mode: "global", kind: "protein" })!;
    expect(dp.score).toBeCloseTo(bruteForceGlobal(a, b, "protein"), 1);
  });

  const DNA: [string, string][] = [
    ["ACGT", "ACGT"],
    ["ACGT", "AGT"],
    ["ACGT", "TGCA"],
    ["ACGTA", "ACGGTA"],
    ["AAAA", "AA"],
    ["ACG", "ACGTTT"],
  ];

  test.each(DNA)("global DNA: %s vs %s", (a, b) => {
    const dp = align(a, b, { mode: "global", kind: "dna" })!;
    expect(dp.score).toBeCloseTo(bruteForceGlobal(a, b, "dna"), 1);
  });

  test.each([
    ["MKTA", "PPMKTAPP"],
    ["WPCG", "MKTA"],
    ["MKTAY", "AYMKT"],
  ] as [string, string][])("local protein: %s vs %s", (a, b) => {
    const dp = align(a, b, { mode: "local", kind: "protein" })!;
    expect(dp.score).toBeCloseTo(bruteForceLocal(a, b, "protein"), 1);
  });

  test.each([
    ["ACGT", "TTACGTTT"],
    ["ACGT", "TTTT"],
    ["ACGTA", "TACGT"],
  ] as [string, string][])("local DNA: %s vs %s", (a, b) => {
    const dp = align(a, b, { mode: "local", kind: "dna" })!;
    expect(dp.score).toBeCloseTo(bruteForceLocal(a, b, "dna"), 1);
  });
});

describe("the brute-force reference is itself sound", () => {
  // Guarding the guard: if the enumerator were wrong, the tests above would be
  // comparing two wrong answers and passing.
  test("it enumerates the expected number of alignments", () => {
    // Alignments of two length-2 sequences: the Delannoy number D(2,2) = 13.
    expect([...allGlobal("AB", "CD")].length).toBe(13);
    // D(1,1) = 3: match, or two orders of gap.
    expect([...allGlobal("A", "B")].length).toBe(3);
  });

  test("it never emits a gap/gap column or a length mismatch", () => {
    for (const [x, y] of allGlobal("ACG", "AT")) {
      expect(x).toHaveLength(y.length);
      for (let i = 0; i < x.length; i++) expect(x[i] === "-" && y[i] === "-").toBe(false);
    }
  });

  test("it recovers the originals when gaps are stripped", () => {
    for (const [x, y] of allGlobal("ACG", "AT")) {
      expect(x.replace(/-/g, "")).toBe("ACG");
      expect(y.replace(/-/g, "")).toBe("AT");
    }
  });

  test("identical sequences brute-force to the sum of their self-scores", () => {
    expect(bruteForceGlobal("MKTA", "MKTA", "protein")).toBe(
      blosum62("M", "M") + blosum62("K", "K") + blosum62("T", "T") + blosum62("A", "A")
    );
  });
});
