// Round 2 of the Antibody review, pinned: a J motif inside CDR3 when framework 4 is cut short, 60-residue H3s, the
// IGLV6 framework-3 insertion (Kabat L66A–B per ANARCI since fix round 2; IMGT 81–82, L2 EDNQRPS), name forms that pair,
// distinct antibody names, the light-chain refusal wording, mislabelled chains and the VHH hallmark rule.
import * as fs from "fs";
import * as path from "path";
import { numberChain } from "../antibody";
import { analyzeAntibodies, claimText, pairChains, pairingNotes, seqIds } from "../antibodyReport";

type Fx = Record<string, { seq: string }>;
const FX: Fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "antibody-numbering.json"), "utf8"));
const TH = FX.trastuzumab_H.seq, TL = FX.trastuzumab_L.seq, PH = FX.pertuzumab_H.seq, PL = FX.pertuzumab_L.seq;
const ok = (seq: string) => {
  const r = numberChain(seq);
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r;
};
const fasta = (...pairs: Array<[string, string]>) => pairs.map(([n, s]) => `>${n}\n${s}`).join("\n");

describe("CDR3 with an internal J motif and a short framework 4", () => {
  test("heavy: W-G-S-G inside H3, framework 4 cut to …TTV, TLV, T or nothing", () => {
    for (const end of ["WGQGTTV", "WGQGTLV", "WGQGT", "WGQG"]) {
      for (const cdr of ["GGSWGSGSYYYYGMDV", "DRYWGSGYFDY"]) {
        const seq = TH.replace("WGGDGFYAMDYWGQGTLVTVSS", cdr + end);
        expect(ok(seq).cdrs.kabat.cdr3.seq).toBe(cdr);
      }
    }
  });
  test("light: F-G-S-G inside L3, framework 4 cut to FGQG", () => {
    const seq = TL.replace("QQHYTTPPTFGQGTKVEIK", "QQYSFGSGPTFGQG");
    expect(ok(seq).cdrs.kabat.cdr3.seq).toBe("QQYSFGSGPT");
  });
  test("a 60-residue H3 with W-G-S-G in it", () => {
    const cdr = "DRWGSG" + "Y".repeat(51) + "FDY";
    expect(ok(TH.replace("WGGDGFYAMDY", cdr)).cdrs.kabat.cdr3.seq).toBe(cdr);
  });
  test("a light chain with no framework 4 is refused in light-chain words", () => {
    const r = numberChain(TL.replace("FGQGTKVEIK", ""));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^A light-chain start but no framework 4/);
  });
});

// Fix round 2 (bio2Fixes.test.ts §8): the Kabat insertion follows ANARCI 2026.2.13.2 — 66A/66B (Chothia 68A/68B) —
// where AntPack, cited here first, puts it at 65A/65B. The two tools disagree; the task directs ANARCI.
describe("IGLV6: two extra framework-3 residues (ANARCI: Kabat L66A–B, IMGT 81–82)", () => {
  const V6 = "NFMLTQPHSVSESPGKTVTISCTRSSGSIASNYVQWYQQRPGSSPTTVIYEDNQRPSGVPDRFSGSIDSSSNSASLTISGLKTEDEADYYCQSYDSSNVVFGGGTKLTVL";
  test("CDR-L2 is EDNQRPS (Kabat) and EDN (IMGT); the insertions are 66A, 66B and IMGT 81, 82", () => {
    const r = ok(V6);
    expect(r.chain).toBe("L");
    expect(r.cdrs.kabat.cdr2.seq).toBe("EDNQRPS");
    expect(r.cdrs.imgt.cdr2.seq).toBe("EDN");
    const k = r.numbering.kabat, i = r.numbering.imgt;
    expect(r.domain[k.indexOf("66A")] + r.domain[k.indexOf("66B")]).toBe("DS");
    expect(r.domain[i.indexOf("80")] + r.domain[i.indexOf("81")] + r.domain[i.indexOf("82")]).toBe("IDS");
    expect(r.notes.join(" ")).not.toMatch(/CDR-L2 has/);
  });
});

describe("names", () => {
  test("common name forms pair", () => {
    const forms: Array<[string, string]> = [
      ["Ab1_VH", "Ab1_VL"],
      ["X VH1", "X VL1"],
      ["X VH", "X VL kappa"],
      ["X heavy chain", "X light chain kappa"],
      ["X VH (humanized)", "X VL (humanized)"],
      ["ab1 vh", "AB1 VL"],
      ["X(VH)", "X(VL)"],
    ];
    for (const [h, l] of forms) {
      const abs = pairChains(analyzeAntibodies(fasta([h, TH], [l, TL])).chains);
      expect([h, abs.length]).toEqual([h, 1]);
    }
  });
  test("pairing does not depend on order: Fab with Fab H either way round", () => {
    for (const order of [fasta(["Fab H", TH], ["Fab", TL]), fasta(["Fab", TL], ["Fab H", TH])]) expect(pairChains(analyzeAntibodies(order).chains)).toHaveLength(1);
  });
  test("still unpaired: VH/VL alone, H/L alone, MAK/MAL", () => {
    for (const [a, b] of [["VH", "VL"], ["H", "L"], ["MAK", "MAL"]]) expect(pairChains(analyzeAntibodies(fasta([a, TH], [b, TL])).chains)).toHaveLength(2);
  });
  test("two antibodies with one stem get distinct names, and the SEQ ID table can tell them apart", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["X VH", TH], ["X VL", TL], ["X heavy", PH], ["X light", PL])).chains);
    expect(abs.map((a) => a.name)).toEqual(["X", "X (2)"]);
    const d = seqIds(abs, "kabat").map((s) => s.description);
    expect(new Set(d).size).toBe(d.length);
  });
  test("a lone chain's descriptions do not repeat its role", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["C VL", TL])).chains);
    expect(seqIds(abs, "kabat").map((s) => s.description)).toContain("C VL");
    expect(seqIds(abs, "kabat").map((s) => s.description).join(" ")).not.toMatch(/VL VL/);
  });
  test("a heavy sequence named VL (and a light one named VH) is said", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["X VL", TH], ["X VH", TL])).chains);
    expect(pairingNotes(abs).join(" ")).toMatch(/X VL: named as a light chain, but it reads as a heavy chain/);
    expect(claimText(abs, { def: "kabat" }).length).toBeGreaterThan(0);
  });
});

describe("round 3: clone labels, bare kappa/lambda, role words inside other words", () => {
  test("different clones never pair; a remark both chains carry still does", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["X VH (clone 3)", TH], ["X VH (clone 4)", PH], ["X VL (clone 4)", PL], ["X VL (clone 3)", TL])).chains);
    expect(abs.map((a) => [a.vh?.name, a.vl?.name])).toEqual([
      ["X VH (clone 3)", "X VL (clone 3)"],
      ["X VH (clone 4)", "X VL (clone 4)"],
    ]);
    expect(abs.map((a) => a.name)).toEqual(["X (clone 3)", "X (clone 4)"]);
    expect(pairChains(analyzeAntibodies(fasta(["X VH (clone 3)", TH], ["X VL (clone 4)", TL])).chains)).toHaveLength(2);
  });
  test("kappa or lambda alone names the light chain", () => {
    for (const [h, l] of [["X heavy", "X kappa"], ["X VH", "X lambda"], ["X VH", "X κ"]]) expect([h, l, pairChains(analyzeAntibodies(fasta([h, TH], [l, TL])).chains).length]).toEqual([h, l, 1]);
  });
  test("HCV, LCMV, Lighthouse, Heavyweight are not role words", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["HCV mAb VH", TH], ["HCV mAb VL", TL], ["LCMV Ab H", PH], ["Lighthouse Ab", PL])).chains);
    expect(pairingNotes(abs).join(" ")).not.toMatch(/named as a/);
    expect(abs[0].name).toBe("HCV mAb");
  });
});
