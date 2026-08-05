// Regression: Align had no size bound, so one ordinary paste froze Word.
//
// `align()` allocates SIX (n+1)×(m+1) arrays. Measured before the bound:
//
//     1 kb × 1 kb   0.4 s    100 MB
//     3 kb × 3 kb   2.2 s    659 MB
//     5 kb × 5 kb   8.3 s   1.81 GB
//
// synchronously on the pane's UI thread, and re-run on every keystroke because
// it is bound to `input`. A 1–5 kb CDS or plasmid is completely ordinary and the
// landing page invites exactly this ("compare your clone to the reference").
//
// A bug in this family does not return a wrong answer — it does not return at
// all — so these tests assert on TIME as well as on value.

import { align, alignSizeRefusal, MAX_ALIGN_CELLS } from "../align";

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function randomDna(n: number, seed = 1): string {
  const r = rng(seed);
  let s = "";
  for (let i = 0; i < n; i++) s += "ACGT"[Math.floor(r() * 4)];
  return s;
}

describe("align size bound — defect 0.2", () => {
  test("the cap is a named, asserted constant", () => {
    expect(MAX_ALIGN_CELLS).toBe(4_000_000);
  });

  test("REPRODUCTION: 3 kb × 3 kb refuses instead of running for seconds", () => {
    // 3000 × 3000 = 9M cells: 2.2 s and 659 MB before the bound. Deliberately not
    // 5 kb × 5 kb — 1.81 GB kills the jest worker, which is a crashed run rather
    // than a red test.
    const a = randomDna(3000, 7);
    const b = randomDna(3000, 99);
    const t0 = Date.now();
    const r = align(a, b);
    const ms = Date.now() - t0;
    expect(r).toBeNull();
    expect(ms).toBeLessThan(200);
  });

  test("the refusal says why and what to do instead", () => {
    const msg = alignSizeRefusal(randomDna(3000, 7), randomDna(3000, 99));
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/million/);
    expect(msg).toMatch(/shorter region/i);
    expect(msg).toMatch(/EMBOSS|BLAST/);
  });

  test("no refusal for a pair that is inside the bound", () => {
    expect(alignSizeRefusal("ACGTACGTAC", "ACGTACGTAC")).toBeNull();
    expect(alignSizeRefusal(randomDna(1500, 3), randomDna(1500, 4))).toBeNull();
  });

  test("the bound is measured on the CLEANED sequences, not the raw paste", () => {
    // A FASTA header is not sequence; counting its characters would refuse a
    // pair that fits (and, with a very long header, mis-size one that does not).
    const header = ">" + "x".repeat(5000) + "\n";
    expect(alignSizeRefusal(header + randomDna(100, 1), header + randomDna(100, 2))).toBeNull();
  });

  test("a pair just under the cap still aligns, and quickly", () => {
    // 1996 × 2003 = 3,997,988 cells — under 4M by a hair.
    const a = randomDna(1996, 11);
    const b = randomDna(2003, 12);
    expect(a.length * b.length).toBeLessThan(MAX_ALIGN_CELLS);
    const t0 = Date.now();
    const r = align(a, b);
    const ms = Date.now() - t0;
    expect(r).not.toBeNull();
    expect(r!.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(20000);
  }, 30000);

  test("the bound is on the FUNCTION: local mode does not sneak past it", () => {
    // The failure mode is allocation, which is identical in both modes — a cap
    // that only covered the default would be a cap in name only.
    expect(align(randomDna(3000, 7), randomDna(3000, 99), { mode: "local" })).toBeNull();
    expect(align(randomDna(3000, 7), randomDna(3000, 99), { mode: "global", kind: "dna" })).toBeNull();
  });

  test("short inputs are unaffected", () => {
    const r = align("ACGTACGTACGT", "ACGTACGAACGT");
    expect(r).not.toBeNull();
    expect(r!.percentIdentity).toBeGreaterThan(80);
  });
});
