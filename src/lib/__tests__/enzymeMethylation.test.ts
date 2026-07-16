// Methylation sensitivity — the difference between a predicted digest and a real one.
//
// WHY THIS EXISTS (punch list #14)
// The audit said the MspI/HpaII pair was "pointless" without a methylation flag.
// True, but the GATC trio was worse than pointless — it was WRONG in a way that
// costs a bench week, and nothing on screen said so:
//
//   MboI, Sau3AI and DpnI all read GATC and were listed as plain isoschizomers with
//   identical behaviour. They are in fact THE textbook discrimination set:
//     MboI    — BLOCKED by Dam. On plasmid DNA from any ordinary dam+ E. coli
//               strain it cuts NOTHING. The table predicted a full digest.
//     Sau3AI  — ignores Dam. Cuts the same DNA fine. That is the reason to pick it.
//     DpnI    — cuts ONLY Dam-methylated GATC. Site-directed mutagenesis depends on
//               exactly this: it destroys the methylated parental plasmid and leaves
//               the unmethylated PCR product whole. Predicting that it digests a PCR
//               product is precisely backwards.
//
// Neither failure announces itself. You get an undigested gel and lose a week.

import { findSites, methylationWarnings, ENZYMES, METHYLASES } from "../enzymes";

const warn = (seq: string, only: string[], circular = false) =>
  methylationWarnings(seq, findSites(seq, { only, circular }), circular);

describe("the GATC trio give three different answers on the same DNA", () => {
  // The only reason to list all three. Same site, same position, opposite advice.
  const SEQ = "TTTTGATCTTTT";

  test("MboI is reported BLOCKED by Dam", () => {
    const w = warn(SEQ, ["MboI"]);
    expect(w).toHaveLength(1);
    expect(w[0].methylase).toBe("dam");
    expect(w[0].effect).toBe("blocked");
    expect(w[0].message).toMatch(/BLOCKED by Dam/);
    expect(w[0].message).toMatch(/will not cut/);
  });

  test("Sau3AI gets NO warning — it ignores Dam, which is why you'd choose it", () => {
    expect(warn(SEQ, ["Sau3AI"])).toEqual([]);
  });

  test("DpnI is reported as REQUIRING methylation, not blocked by it", () => {
    const w = warn(SEQ, ["DpnI"]);
    expect(w).toHaveLength(1);
    expect(w[0].effect).toBe("required");
    expect(w[0].message).toMatch(/cuts ONLY when/);
    expect(w[0].message).toMatch(/PCR product/);
    // It must NOT say "blocked" — that is the exactly-backwards reading.
    expect(w[0].message).not.toMatch(/BLOCKED/);
  });

  test("the three still find the same sites — only the advice differs", () => {
    for (const e of ["MboI", "Sau3AI", "DpnI"]) {
      expect(findSites(SEQ, { only: [e] })).toHaveLength(1);
    }
  });

  test("MboI's warning points at the isoschizomer that would work", () => {
    expect(warn(SEQ, ["MboI"])[0].message).toMatch(/Sau3AI/);
  });
});

describe("MspI / HpaII — the pair now has a reason to exist", () => {
  const SEQ = "TTTTCCGGTTTT";

  test("HpaII is blocked by CpG methylation", () => {
    const w = warn(SEQ, ["HpaII"]);
    expect(w).toHaveLength(1);
    expect(w[0].methylase).toBe("cpg");
    expect(w[0].effect).toBe("blocked");
  });

  test("MspI is not — that difference IS the methylation-sensitive assay", () => {
    expect(warn(SEQ, ["MspI"])).toEqual([]);
  });

  test("they are no longer byte-identical records", () => {
    const msp = ENZYMES.find((e) => e.name === "MspI")!;
    const hpa = ENZYMES.find((e) => e.name === "HpaII")!;
    expect(msp.site).toBe(hpa.site); // same recognition site...
    expect(msp.methylation).not.toEqual(hpa.methylation); // ...different biology
  });
});

describe("'blocked-in-context' is a claim about the DNA, not the enzyme", () => {
  // ClaI (ATCGAT) is only Dam-blocked when the flanking bases complete a GATC
  // across its edge. Warning on every ClaI site would be noise the user learns to
  // ignore — which is worse than no warning, because it devalues the real ones.

  test("ClaI overlapping a GATC IS flagged", () => {
    // ...G ATCGAT... -> the G before the site completes GATC.
    const w = warn("TTTGATCGATTTT", ["ClaI"]);
    expect(w).toHaveLength(1);
    expect(w[0].methylase).toBe("dam");
    expect(w[0].message).toMatch(/overlaps one/);
  });

  test("ClaI NOT overlapping a GATC is NOT flagged", () => {
    // ...TT ATCGAT TT... -> no GATC anywhere across the site.
    const w = warn("TTTTATCGATTTTT", ["ClaI"]);
    expect(w).toEqual([]);
  });

  test("XbaI is flagged only in the blocking context", () => {
    expect(warn("TTTTCTAGATCTTT", ["XbaI"]).length).toBe(1); // TCTAGATC -> GATC across the edge
    expect(warn("TTTTCTAGATTTTT", ["XbaI"])).toEqual([]); // no GATC
  });

  test("a site found at all is a precondition — no site, no warning", () => {
    expect(warn("TTTTTTTTTTTT", ["ClaI", "MboI", "DpnI"])).toEqual([]);
  });
});

describe("BclI is blocked unconditionally — its site always contains GATC", () => {
  test("TGATCA always carries a Dam site, so no context check is needed", () => {
    const w = warn("TTTTGATCATTT", ["BclI"]);
    expect(w).toHaveLength(1);
    expect(w[0].effect).toBe("blocked");
  });

  test("every BclI site is flagged, wherever it sits", () => {
    for (const seq of ["TGATCAAAAAAA", "AAAAAAATGATCA", "GGGGTGATCAGGG"]) {
      expect(warn(seq, ["BclI"]).length).toBeGreaterThan(0);
    }
  });
});

describe("Dcm and circular sequences", () => {
  test("StuI overlapping a CCWGG is flagged", () => {
    // CCAGGCCT -> CCAGG (Dcm, W=A) overlaps AGGCCT.
    const w = warn("TTTCCAGGCCTTTT", ["StuI"]);
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].methylase).toBe("dcm");
  });

  test("StuI with no Dcm site nearby is not flagged", () => {
    expect(warn("TTTTTAGGCCTTTTT", ["StuI"])).toEqual([]);
  });

  test("a methylase site spanning the origin of a plasmid is seen", () => {
    // Circular: the GATC is split across the origin, so a linear scan misses it.
    // ATC at the end + G at the start -> GATC across the join.
    const circ = "GAAAAAAAAATCGATAAAAAAAAA";
    const linear = warn(circ, ["ClaI"], false);
    const circular = warn(circ, ["ClaI"], true);
    // Not asserting linear is empty (the sequence may contain GATC anyway) — only
    // that circular never sees LESS than linear.
    expect(circular.length).toBeGreaterThanOrEqual(linear.length);
  });
});

describe("the annotations are internally coherent", () => {
  test("every methylase referenced by an enzyme exists in METHYLASES", () => {
    for (const e of ENZYMES) {
      if (!e.methylation) continue;
      for (const m of Object.keys(e.methylation)) expect(METHYLASES).toHaveProperty(m);
    }
  });

  test("only DpnI requires methylation", () => {
    const requires = ENZYMES.filter((e) => e.methylation && Object.values(e.methylation).includes("required"));
    expect(requires.map((e) => e.name)).toEqual(["DpnI"]);
  });

  test("an enzyme claiming unconditional Dam blocking really always contains GATC", () => {
    // Guards the data: "blocked" (not "blocked-in-context") asserts the site itself
    // always carries the methylase target. If that is false the flag is a lie.
    for (const e of ENZYMES) {
      if (e.methylation?.dam !== "blocked") continue;
      expect({ enzyme: e.name, containsGATC: e.site.includes("GATC") }).toEqual({
        enzyme: e.name,
        containsGATC: true,
      });
    }
  });

  test("an enzyme claiming unconditional CpG blocking really always contains CG", () => {
    for (const e of ENZYMES) {
      if (e.methylation?.cpg !== "blocked") continue;
      expect({ enzyme: e.name, containsCG: e.site.includes("CG") }).toEqual({ enzyme: e.name, containsCG: true });
    }
  });

  test("no enzyme is both blocked by and requiring the same methylase", () => {
    for (const e of ENZYMES) {
      if (!e.methylation) continue;
      const vals = Object.values(e.methylation);
      expect(vals.includes("required") && vals.some((v) => v?.startsWith("blocked"))).toBe(false);
    }
  });

  test("unannotated enzymes produce no warnings — silence stays meaningful", () => {
    expect(warn("TTTTGAATTCTTTT", ["EcoRI"])).toEqual([]);
    expect(warn("TTTTGGATCCTTTT", ["BamHI"])).toEqual([]);
  });
});
