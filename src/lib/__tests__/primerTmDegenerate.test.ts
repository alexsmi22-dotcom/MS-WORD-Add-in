// Degenerate-primer Tm: the property under test is ERROR AGAINST REAL MEMBERS OF
// THE POOL, not the shape of an internal constant.
//
// Three designs have now been measured against each other. A degenerate oligo is a
// MIXTURE, and every member has its own Tm, so the only checkable question is how
// far a reported number sits from the Tm of sequences that actually exist.
//
//   1. DELETING the ambiguity codes joined the two flanking bases into a stacking
//      step the oligo does not contain, and under-reported its length (a 20-mer
//      read "length 18").
//   2. SKIPPING the steps containing one dropped real stacking from the sum while
//      the salt term kept scaling with the full length. Measured against the pool
//      midpoint this was WORSE than the deletion it replaced:
//
//        ACNTACGTACGTACGTACGT   skip −5.8   delete −2.8   pool 52.7..57.1
//        ACNTACNTACGTACGTACGT   skip −12.3  delete −5.1   pool 50.2..57.1
//
//      At exactly MAX_SKIPPED_NN_STEPS = 4 (the second row, which that design
//      ALLOWED) the quoted Tm was 8.8 °C below the COLDEST member of the pool,
//      against a documented budget of "~8 °C" and a module docstring calling a
//      7 °C error "a failed PCR". The constant bounded a proxy, not the error.
//   3. ENUMERATING the pool and reporting the exact range. No error budget exists
//      to calibrate, because no value is estimated.
//
// The previous version of this file asserted `expect(MAX_SKIPPED_NN_STEPS).toBe(4)`
// — a literal checked against itself, which would have passed at any value and
// tested nothing. These tests derive their expectations from enumerated members.

import { primerTm, proteinProperties, expandIupac, MAX_POOL_MEMBERS } from "../dna";

const IUPAC: Record<string, string[]> = {
  A: ["A"], C: ["C"], G: ["G"], T: ["T"],
  R: ["A", "G"], Y: ["C", "T"], S: ["C", "G"], W: ["A", "T"], K: ["G", "T"], M: ["A", "C"],
  B: ["C", "G", "T"], D: ["A", "G", "T"], H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"],
};

/** Independent expansion, so the test does not lean on the code it is checking. */
function members(seq: string): string[] {
  let out = [""];
  for (const ch of seq) {
    const exp = IUPAC[ch] ?? [ch];
    const next: string[] = [];
    for (const p of out) for (const b of exp) next.push(p + b);
    out = next;
  }
  return out;
}

/** Tm of every concrete member, computed through the same public entry point. */
function poolTms(seq: string): number[] {
  return members(seq).map((m) => primerTm(m).tm);
}

const DEGENERATE = "ACGTRYACGTACGTACGTAC"; // 20-mer, R at 5 and Y at 6
const PARENT = "ACGTACACGTACGTACGTAC"; // a concrete member of that pool
const BOUNDARY = "ACNTACNTACGTACGTACGT"; // the old MAX_SKIPPED_NN_STEPS = 4 case

describe("primerTm on degenerate oligos — exact pool enumeration", () => {
  test("the true oligo length is reported, ambiguity codes included", () => {
    expect(primerTm(DEGENERATE).length).toBe(20);
    expect(primerTm(DEGENERATE).ambiguous).toBe(2);
  });

  test("NOTHING IS INVENTED: both range endpoints are a real member's Tm", () => {
    const r = primerTm(DEGENERATE);
    const tms = poolTms(DEGENERATE);
    expect(r.poolSize).toBe(4);
    expect(r.tmMin).toBeCloseTo(Math.min(...tms), 10);
    expect(r.tmMax).toBeCloseTo(Math.max(...tms), 10);
    // Spelled out literally. The four members of ACGTRYACGT… are:
    //   ACGTACACGTACGTACGTAC  53.8271
    //   ACGTATACGTACGTACGTAC  50.9933  <- coldest, and what `tm` must report
    //   ACGTGCACGTACGTACGTAC  57.0247  <- warmest
    //   ACGTGTACGTACGTACGTAC  53.8271
    // Note the coldest is the A/T variant, not the A/C one: which member melts
    // lowest depends on STACKING, so it cannot be picked off per position. That is
    // also why the pool is enumerated rather than chosen greedily — measured on
    // ACGTACGTACGTNNNNNNNN, greedy gives 44.67..64.84 against a true 44.40..65.38.
    expect(r.tmMin).toBeCloseTo(primerTm("ACGTATACGTACGTACGTAC").tm, 10);
    expect(r.tmMax).toBeCloseTo(primerTm("ACGTGCACGTACGTACGTAC").tm, 10);
  });

  test("the reported tm IS the pool minimum, not an average or a midpoint", () => {
    const r = primerTm(DEGENERATE);
    const tms = poolTms(DEGENERATE);
    const mean = tms.reduce((a, b) => a + b, 0) / tms.length;
    expect(r.tm).toBeCloseTo(r.tmMin!, 10);
    expect(r.tm).toBeLessThan(mean);
    // And it is a value the model really produces for a real sequence.
    expect(tms.some((t) => Math.abs(t - r.tm) < 1e-9)).toBe(true);
  });

  test("the range BRACKETS every member, including the concrete parent", () => {
    const r = primerTm(DEGENERATE);
    for (const t of poolTms(DEGENERATE)) {
      expect(t).toBeGreaterThanOrEqual(r.tmMin! - 1e-9);
      expect(t).toBeLessThanOrEqual(r.tmMax! + 1e-9);
    }
    const parent = primerTm(PARENT).tm;
    expect(parent).toBeGreaterThanOrEqual(r.tmMin! - 1e-9);
    expect(parent).toBeLessThanOrEqual(r.tmMax! + 1e-9);
  });

  test("REGRESSION: no reported Tm sits below the coldest member of its pool", () => {
    // This is the defect the old MAX_SKIPPED_NN_STEPS = 4 boundary shipped: at
    // exactly four skipped steps the quoted value was 8.8 °C colder than any
    // sequence in the pool, i.e. a temperature no member of the mixture has.
    for (const seq of [DEGENERATE, BOUNDARY, "ACNTACGTACGTACGTACGT", "GGNTGGCANAARGGNTTYCA"]) {
      const r = primerTm(seq);
      expect(r.refusal).toBeUndefined();
      const coldest = Math.min(...poolTms(seq));
      expect(r.tm).toBeGreaterThanOrEqual(coldest - 1e-9);
      expect(r.tm).toBeCloseTo(coldest, 10);
    }
  });

  test("the old four-skipped-step boundary now reports the pool, not a lie", () => {
    const r = primerTm(BOUNDARY);
    const tms = poolTms(BOUNDARY);
    expect(r.poolSize).toBe(16);
    expect(r.tmMin).toBeCloseTo(Math.min(...tms), 10);
    expect(r.tmMax).toBeCloseTo(Math.max(...tms), 10);
    // The skip design returned 41.37 °C here. Every real member is warmer.
    expect(r.tm).toBeGreaterThan(45);
  });

  test("a textbook degenerate primer is answered, not refused", () => {
    // GGNTGGCANAARGGNTTYCA — 5 degenerate positions, 256 members. The skip design
    // refused this outright while quoting a worse answer for an easier oligo.
    const r = primerTm("GGNTGGCANAARGGNTTYCA");
    expect(r.refusal).toBeUndefined();
    expect(r.poolSize).toBe(256);
    expect(r.ambiguous).toBe(5);
    const tms = poolTms("GGNTGGCANAARGGNTTYCA");
    expect(r.tmMin).toBeCloseTo(Math.min(...tms), 10);
    expect(r.tmMax).toBeCloseTo(Math.max(...tms), 10);
  });

  test("the caveat states the range, the spread and which end tm is", () => {
    const r = primerTm(DEGENERATE);
    const first = r.caveats[0];
    expect(first).toMatch(/Degenerate oligo/);
    expect(first).toMatch(/4 sequences/);
    expect(first).toMatch(new RegExp(`${r.tmMin!.toFixed(1)}–${r.tmMax!.toFixed(1)} °C`));
    expect(first).toMatch(/pool MINIMUM/);
  });

  test("a wide pool is self-describing rather than needing a threshold", () => {
    const r = primerTm("ACGTACGTACGTNNNNNNNN"); // 8 N = 65536 members
    // Past the cost bound, so refused — but named as a size, not as an error budget.
    expect(r.refusal).toMatch(/65,536 different sequences/);
    expect(r.refusal).toMatch(/library rather than a primer/);
    expect(r.tm).toBe(0);
  });

  test("a fully degenerate oligo never returns a negative Tm dressed as data", () => {
    for (const seq of ["NNNNNNNNNNNNNNNNNNNN", "ACNNNNNNNNNNNNNNNNNN", "ANANANANANANANANANAN"]) {
      const r = primerTm(seq);
      expect(r.refusal).toBeTruthy();
      expect(r.tm).toBe(0);
      expect(r.tm).not.toBeLessThan(0);
    }
  });

  test("a refusal is stated ONCE, not echoed into caveats as well", () => {
    // The pane prints `refusal` and then joins `caveats` underneath it, so a
    // refusal that also sat in caveats was shown to the user twice.
    for (const seq of ["NNNNNNNNNNNNNNNNNNNN", "ACETACGTACGTACGTACGT", "ACGTACGTACGTNNNNNNNN"]) {
      const r = primerTm(seq);
      expect(r.refusal).toBeTruthy();
      expect(r.caveats).toEqual([]);
    }
  });

  test("a letter that is not a nucleotide is REFUSED, not treated as ambiguity", () => {
    // "ACETACGTACGTACGTACGT" used to return 49.07 °C for a string containing E.
    const r = primerTm("ACETACGTACGTACGTACGT");
    expect(r.refusal).toMatch(/is not a nucleotide/);
    expect(r.refusal).toMatch(/E/);
    expect(r.tm).toBe(0);
    expect(r.tmMin).toBeUndefined();
  });

  test("degenerate SHORT oligos are enumerated too, on the Wallace path", () => {
    // The skip design returned 18 °C for ACNTACG while every real member is
    // 20–22 °C, because ambiguous bases counted as neither AT nor GC.
    const r = primerTm("ACNTACG");
    expect(r.method).toBe("wallace");
    expect(r.poolSize).toBe(4);
    const tms = poolTms("ACNTACG");
    expect(r.tmMin).toBeCloseTo(Math.min(...tms), 10);
    expect(r.tmMax).toBeCloseTo(Math.max(...tms), 10);
    expect(r.tm).toBeGreaterThanOrEqual(20);
    expect(r.caveats.some((c) => /Wallace rule/.test(c))).toBe(true);
  });

  test("GC% is over the DEFINED bases, not the whole string", () => {
    // ACGTRYACGTACGTACGTAC: 18 defined bases, 9 of them G or C.
    expect(primerTm(DEGENERATE).gcPercent).toBeCloseTo((9 / 18) * 100, 6);
  });

  test("ΔH/ΔS are omitted for a pool and present for a defined oligo", () => {
    expect(primerTm(DEGENERATE).deltaH).toBeUndefined();
    expect(primerTm(DEGENERATE).deltaS).toBeUndefined();
    expect(primerTm(PARENT).deltaH).toBeLessThan(0);
    expect(primerTm(PARENT).deltaS).toBeLessThan(0);
  });

  test("an unambiguous primer is completely unchanged", () => {
    const r = primerTm(PARENT);
    expect(r.length).toBe(20);
    expect(r.ambiguous).toBe(0);
    expect(r.refusal).toBeUndefined();
    expect(r.poolSize).toBeUndefined();
    expect(r.tmMin).toBeUndefined();
    expect(r.method).toBe("nearest-neighbour");
    expect(r.caveats.some((c) => /Degenerate oligo/.test(c))).toBe(false);
    expect(r.tm).toBeCloseTo(53.8271, 3);
  });

  test("whitespace and digits are still stripped", () => {
    expect(primerTm("ACGT ACAC GTAC GTAC GTAC").length).toBe(20);
    expect(primerTm("1 ACGTACACGTACGTACGTAC").tm).toBeCloseTo(primerTm(PARENT).tm, 10);
  });

  test("expandIupac counts the pool before building it", () => {
    expect(expandIupac("ACGT")).toEqual({ kind: "ok", members: ["ACGT"] });
    const r = expandIupac("RY");
    expect(r.kind).toBe("ok");
    expect(r.kind === "ok" && r.members.sort()).toEqual(["AC", "AT", "GC", "GT"]);
    expect(expandIupac("E")).toEqual({ kind: "unresolvable", letters: ["E"] });
    const big = expandIupac("N".repeat(12)); // 4^12, far past the bound
    expect(big.kind).toBe("too-large");
    expect(big.kind === "too-large" && big.size).toBeGreaterThan(MAX_POOL_MEMBERS);
  });

  test("the cost bound holds the per-keystroke path in single-digit ms", () => {
    // primerTm runs on every keypress in the DNA pane, so this is a real budget.
    const worst = "N".repeat(6) + "ACGTACGTACGTAC"; // 4096 members, the maximum
    expect(primerTm(worst).poolSize).toBe(MAX_POOL_MEMBERS);
    const t0 = Date.now();
    primerTm(worst);
    expect(Date.now() - t0).toBeLessThan(400); // generous for CI; ~9 ms locally
  });

  test("REGRESSION: a long paste with a few N does not hang the pane", () => {
    // Found by the adversarial pass on this very change. MAX_POOL_MEMBERS bounds
    // the pool but NOT the work: the DNA pane hands primerTm the whole pasted
    // sequence, so 5,000 nt carrying six N is 4,096 strings of 5,000 nt —
    // 20,480,000 bases and a measured 15.4 SECONDS of synchronous work per
    // keystroke. members × length is the quantity that has to be bounded.
    const long = "N".repeat(6) + "ACGT".repeat(1249);
    const t0 = Date.now();
    const r = primerTm(long);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.refusal).toMatch(/would hang the pane/);
    expect(r.refusal).toMatch(/paste just the primer/);
    expect(r.tm).toBe(0);

    // …but a long sequence with LITTLE degeneracy is still answered, because the
    // bound is on total work rather than on either factor alone.
    const mild = "N" + "ACGT".repeat(500); // 4 members × 2001 nt = 8,004 bases
    expect(primerTm(mild).refusal).toBeUndefined();
    expect(primerTm(mild).poolSize).toBe(4);
  });

  test("REGRESSION: zero salt or primer never returns absolute zero as a Tm", () => {
    // Both concentrations sit inside a logarithm. At exactly 0 the entropy term
    // goes to −∞ and the formula returned −273.15 °C — finite, so the existing
    // isFinite guard passed it straight through as though it were a measurement.
    for (const opts of [{ sodium: 0 }, { primer: 0 }, { sodium: 0, primer: 0 }, { sodium: -1 }]) {
      const r = primerTm("ACGTACACGTACGTACGTAC", opts);
      expect(r.refusal).toMatch(/greater than zero/);
      expect(r.tm).toBe(0);
      expect(r.tm).not.toBe(-273.15);
    }
    // The normal path is untouched.
    expect(primerTm("ACGTACACGTACGTACGTAC", { sodium: 0.05 }).refusal).toBeUndefined();
  });
});

describe("proteinProperties reports what it did not count", () => {
  test("stops are counted, and are not double-counted as skipped residues", () => {
    // translate() emits "*" whenever stopAtStop is off, so a frame carrying stops
    // is the common case rather than an exotic one.
    const r = proteinProperties("MKV*LSPADK*TNVKAAW");
    expect(r.stops).toBe(2);
    expect(r.length).toBe(16);
    expect(r.inputLength).toBe(16); // stop symbols are not residues
    expect(r.skippedCount).toBe(0);
  });

  test("a TERMINAL stop is not reported as internal — that distinction is the point", () => {
    // A trailing "*" is the ordinary end of a CDS. Reporting it as "1 internal
    // stop codon — not an ORF" would be a false alarm on correct input, which is
    // exactly the failure this field exists to avoid.
    const terminal = proteinProperties("MKVLSPADKTNVKAAW*");
    expect(terminal.stops).toBe(1);
    expect(terminal.internalStops).toBe(0);

    const internal = proteinProperties("MKV*LSPADKTNVKAAW");
    expect(internal.stops).toBe(1);
    expect(internal.internalStops).toBe(1);

    const both = proteinProperties("MKV*LSPADK*TNVKAAW*");
    expect(both.stops).toBe(3);
    expect(both.internalStops).toBe(2);
  });

  test("trailing whitespace does not turn a terminal stop into an internal one", () => {
    expect(proteinProperties("MKVLSPADKTNVKAAW*\n").internalStops).toBe(0);
    expect(proteinProperties("MKVLSPADKTNVKAAW* ").internalStops).toBe(0);
  });

  test("unknown residues are counted separately from stops", () => {
    const r = proteinProperties("MKVLSPADKTNVKAAWXXXX");
    expect(r.stops).toBe(0);
    expect(r.internalStops).toBe(0);
    expect(r.length).toBe(16);
    expect(r.inputLength).toBe(20);
    expect(r.skippedCount).toBe(4);
    expect(r.skipped).toEqual(["X"]);
  });

  test("an all-stop string still returns a usable shape", () => {
    const r = proteinProperties("***");
    expect(r.length).toBe(0);
    expect(r.stops).toBe(3);
    expect(r.internalStops).toBe(2);
    expect(r.mw).toBe(0);
  });
});
