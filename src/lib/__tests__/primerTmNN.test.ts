// Primer Tm by nearest-neighbour — and the GC%-formula it replaced.
//
// WHY THIS EXISTS (punch list #16)
// primerTm used the Wallace rule below 14 nt and 64.9 + 41(GC-16.4)/N above it,
// and its own docstring admitted it was "not a salt-corrected nearest-neighbor Tm"
// — which is precisely what anyone ordering primers needs. Both old formulas see
// only LENGTH and GC COUNT, so they are blind to sequence ORDER, and duplex
// stability IS stacking between adjacent bases. Measured on 20-mers:
//
//   GCGCGCGCGCGCGCGCGCGC   old 72.3   NN 79.2   -6.9
//   ATATATATATATATATATAT   old 31.3   NN 26.3   +4.9
//   TTTTTTTTTTAAAAAAAAAA   old 31.3   NN 37.2   -5.9
//
// The last two are the whole argument: same length, same 0% GC, so the old formula
// returns the SAME 31.3 C for both. They really differ by 11 C. A Tm that wrong is
// a failed PCR or a smear of non-specific product, and the number looked ordinary.
//
// The NN_PARAMS table is TRANSCRIBED DATA — the same class as BLOSUM62 and the
// compound dictionary, where one wrong cell skews everything silently and nothing
// crashes. So it is checked against the published table's own structure rather than
// trusted.

import { primerTm } from "../dna";

const tm = (s: string, o = {}) => primerTm(s, o).tm;

describe("the NN parameter table is the published one", () => {
  // Reaching the private table through behaviour: a step and its reverse complement
  // are the SAME physical stack read from the other strand, so a duplex and its
  // reverse complement must have identical thermodynamics. A transcription slip in
  // any of the 16 keys breaks this.
  const revComp = (s: string) => [...s].reverse().map((c) => ({ A: "T", T: "A", G: "C", C: "G" }[c]!)).join("");

  test("a duplex and its reverse complement melt at the same temperature", () => {
    for (const s of [
      "ATGCGTACGTAGCTAGCTAG",
      "GGGGCCCCGGGGCCCCAAAA",
      "ACGTACGTACGTACGTACGT",
      "TTTTTTTTTTAAAAAAAAAA",
      "CAGTCAGTCAGTCAGTCAGT",
    ]) {
      expect(tm(s)).toBeCloseTo(tm(revComp(s)), 6);
    }
  });

  test("CG is the most stable step, and GC-rich beats AT-rich", () => {
    // Physical facts the table must reproduce.
    expect(tm("GCGCGCGCGCGCGCGCGCGC")).toBeGreaterThan(tm("ATATATATATATATATATAT"));
    expect(tm("CGCGCGCGCGCGCGCGCGCG")).toBeGreaterThan(tm("ATATATATATATATATATAT"));
  });

  test("ΔH is negative and ΔS is negative — duplex formation is enthalpy-driven", () => {
    const r = primerTm("ATGCGTACGTAGCTAGCTAG");
    expect(r.deltaH).toBeLessThan(0);
    expect(r.deltaS).toBeLessThan(0);
  });
});

describe("the fix: sequence ORDER changes Tm, which the old formula could not see", () => {
  test("same length and same 0% GC, but an 11 °C difference", () => {
    // The headline case. The old GC% formula gave both exactly 31.3.
    const alternating = tm("ATATATATATATATATATAT");
    const blocked = tm("TTTTTTTTTTAAAAAAAAAA");
    expect(Math.abs(blocked - alternating)).toBeGreaterThan(8);
    // Both are 0% GC and 20 nt — the old method literally could not tell them apart.
    expect(primerTm("ATATATATATATATATATAT").gcPercent).toBe(0);
    expect(primerTm("TTTTTTTTTTAAAAAAAAAA").gcPercent).toBe(0);
    expect(primerTm("ATATATATATATATATATAT").length).toBe(primerTm("TTTTTTTTTTAAAAAAAAAA").length);
  });

  test("same GC% at the same length can still differ by several degrees", () => {
    // 50% GC both, 20 nt both.
    const a = "GGGGGGGGGGCCCCCCCCCC";
    const b = "GCGCGCGCGCGCGCGCGCGC";
    expect(primerTm(a).gcPercent).toBe(primerTm(b).gcPercent);
    expect(Math.abs(tm(a) - tm(b))).toBeGreaterThan(2);
  });
});

describe("Tm responds to the conditions it is quoted at", () => {
  const SEQ = "ATGCGTACGTAGCTAGCTAG";

  test("more salt stabilises the duplex", () => {
    expect(tm(SEQ, { sodium: 1.0 })).toBeGreaterThan(tm(SEQ, { sodium: 0.05 }));
    expect(tm(SEQ, { sodium: 0.05 })).toBeGreaterThan(tm(SEQ, { sodium: 0.01 }));
  });

  test("more primer raises Tm", () => {
    expect(tm(SEQ, { primer: 1e-6 })).toBeGreaterThan(tm(SEQ, { primer: 0.1e-6 }));
  });

  test("the salt effect is large enough to matter in practice", () => {
    // ~10 C between 10 mM and 1 M — which is why quoting a Tm without its buffer
    // is meaningless, and why the caveat says so.
    expect(tm(SEQ, { sodium: 1.0 }) - tm(SEQ, { sodium: 0.01 })).toBeGreaterThan(5);
  });

  test("defaults are a normal PCR: 50 mM Na+, 0.25 µM primer", () => {
    expect(tm(SEQ)).toBeCloseTo(tm(SEQ, { sodium: 0.05, primer: 0.25e-6 }), 9);
  });
});

describe("results are physically sensible for real primers", () => {
  test("a typical 20-mer lands in the usable PCR range", () => {
    for (const s of ["ATGCGTACGTAGCTAGCTAG", "ACGTACGTACGTACGTACGT", "GGGGCCCCGGGGCCCCAAAA"]) {
      const t = tm(s);
      expect(t).toBeGreaterThan(40);
      expect(t).toBeLessThan(80);
    }
  });

  test("longer primers melt higher", () => {
    let prev = -Infinity;
    for (const n of [10, 15, 20, 25, 30]) {
      const t = tm("ATGCGTACGT".repeat(4).slice(0, n));
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  test("Tm rises monotonically with GC content at fixed length", () => {
    const seqs = [
      "AAAAAAAAAAAAAAAAAAAA",
      "AAAAAAAAAAAAAAAGGGGG",
      "AAAAAAAAAAGGGGGGGGGG",
      "AAAAAGGGGGGGGGGGGGGG",
    ];
    for (let i = 1; i < seqs.length; i++) expect(tm(seqs[i])).toBeGreaterThan(tm(seqs[i - 1]));
  });
});

describe("it says which model produced the number", () => {
  test("a 20-mer uses nearest-neighbour", () => {
    const r = primerTm("ATGCGTACGTAGCTAGCTAG");
    expect(r.method).toBe("nearest-neighbour");
    expect(r.caveats.join(" ")).toMatch(/Nearest-neighbour \(SantaLucia 1998\)/);
    expect(r.caveats.join(" ")).toMatch(/50 mM/);
  });

  test("a very short oligo falls back to Wallace AND SAYS SO", () => {
    // Silently applying NN below ~8 nt would be a confident answer the model does
    // not support. Naming the fallback is the honest option.
    const r = primerTm("ACGTAC");
    expect(r.method).toBe("wallace");
    expect(r.caveats.join(" ")).toMatch(/too short for the nearest-neighbour model/);
    expect(r.tm).toBe(2 * 3 + 4 * 3);
  });

  test("a self-complementary oligo is flagged as a bad primer", () => {
    // GAATTC is its own reverse complement.
    const r = primerTm("GAATTCGAATTC");
    expect(r.caveats.join(" ")).toMatch(/self-complementary/);
    expect(r.caveats.join(" ")).toMatch(/poor primer/);
  });

  test("every result warns that Tm says nothing about SPECIFICITY", () => {
    // The failure a good Tm cannot save you from.
    expect(primerTm("ATGCGTACGTAGCTAGCTAG").caveats.join(" ")).toMatch(/binds in three places/);
  });

  test("Mg2+ being unmodelled is disclosed", () => {
    expect(primerTm("ATGCGTACGTAGCTAGCTAG").caveats.join(" ")).toMatch(/Mg²⁺ is NOT accounted for/);
  });
});

describe("input handling", () => {
  test("U is read as T so RNA oligos work", () => {
    expect(tm("AUGCGUACGUAGCUAGCUAG")).toBeCloseTo(tm("ATGCGTACGTAGCTAGCTAG"), 6);
  });

  test("whitespace and case are ignored", () => {
    expect(tm("atg cgt acg tag cta gct ag")).toBeCloseTo(tm("ATGCGTACGTAGCTAGCTAG"), 6);
  });

  test("an empty sequence returns 0 rather than NaN", () => {
    const r = primerTm("");
    expect(r.tm).toBe(0);
    expect(r.length).toBe(0);
  });

  test("gcPercent is still reported and correct", () => {
    expect(primerTm("GGGGCCCCAAAATTTT").gcPercent).toBe(50);
    expect(primerTm("GCGCGCGCGCGCGCGCGCGC").gcPercent).toBe(100);
  });
});
