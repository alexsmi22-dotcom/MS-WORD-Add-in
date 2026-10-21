// The independent review of the Antibody tool, pinned: chains paired by name in any order, SEQ ID NOs in the claims
// that match the table, a W-G-x-G inside CDR-H3, VHHs that read W-Y-R-Q, λ chains with uncommon starts, long H3s,
// T-cell receptors, several domains in one sequence, ST.26's four-residue floor, and the parser's edge cases.
import * as fs from "fs";
import * as path from "path";
import { numberChain } from "../antibody";
import { analyzeAntibodies, claimText, pairChains, pairingNotes, parseEntries, seqIds } from "../antibodyReport";

type Fx = Record<string, { seq: string }>;
const FX: Fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "antibody-numbering.json"), "utf8"));
const TH = FX.trastuzumab_H.seq, TL = FX.trastuzumab_L.seq, PH = FX.pertuzumab_H.seq, PL = FX.pertuzumab_L.seq;
const VHH = FX.caplacizumab_VHH.seq;
const LINKER = "GGGGSGGGGSGGGGS";
const fasta = (...pairs: Array<[string, string]>) => pairs.map(([n, s]) => `>${n}\n${s}`).join("\n");
const ok = (seq: string) => {
  const r = numberChain(seq);
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r;
};

describe("pairing by name, whatever the order", () => {
  test("all heavies then all lights: each VH with its own VL", () => {
    const a = analyzeAntibodies(fasta(["A VH", TH], ["B VH", PH], ["A VL", TL], ["B VL", PL]));
    const abs = pairChains(a.chains);
    expect(abs.map((x) => [x.name, x.vh?.name, x.vl?.name])).toEqual([
      ["A", "A VH", "A VL"],
      ["B", "B VH", "B VL"],
    ]);
    expect(pairingNotes(abs)).toEqual([]);
    expect(claimText(abs, { def: "kabat" })).toHaveLength(6);
  });
  test("light before heavy pairs; a conventional VH is never called a single-domain antibody", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["A VL", TL], ["A VH", TH])).chains);
    expect(abs).toHaveLength(1);
    expect(abs[0].vh && abs[0].vl).toBeTruthy();
    const solo = pairChains(analyzeAntibodies(fasta(["A VH", TH], ["B VL", TL], ["C VL", PL])).chains);
    const c = claimText(solo, { def: "kabat" });
    expect(c.join("\n")).not.toMatch(/single-domain/);
    expect(c[0]).toMatch(/^1\. An isolated antibody, or antigen-binding fragment thereof, comprising a heavy chain variable region \(VH\) that comprises an HCDR1/);
    expect(pairingNotes(solo)[0]).toMatch(/^A VH: a VH with no VL of the same name/);
  });
  test("a VL–linker–VH scFv is one antibody with both chains", () => {
    const a = analyzeAntibodies(`>scFv\n${TL}${LINKER}${TH}`);
    expect(a.chains.map((c) => c.name)).toEqual(["scFv VL", "scFv VH"]);
    const abs = pairChains(a.chains);
    expect(abs).toHaveLength(1);
    expect(abs[0].name).toBe("scFv");
    expect(claimText(abs, { def: "kabat" })[0]).toMatch(/comprising a heavy chain variable region \(VH\) and a light chain variable region \(VL\)/);
  });
  test("a refused chain does not shift the pairing onto another antibody's chain", () => {
    const bad = TL.slice(0, 50) + "X" + TL.slice(51);
    const a = analyzeAntibodies(fasta(["A VH", TH], ["A VL", bad], ["B VL", PL]));
    expect(a.errors[0]).toMatch(/^A VL: /);
    const abs = pairChains(a.chains);
    expect(abs.map((x) => [x.vh?.name ?? null, x.vl?.name ?? null])).toEqual([
      ["A VH", null],
      [null, "B VL"],
    ]);
  });
  test("one VH and one VL pasted alone, without names, are one antibody", () => {
    const abs = pairChains(analyzeAntibodies(`${TH}\n\n${TL}`).chains);
    expect(abs).toHaveLength(1);
    expect(abs[0].vh && abs[0].vl).toBeTruthy();
  });
  test("a lone VHH (hallmarks F37 R45 L47) is claimed as a single-domain antibody", () => {
    const abs = pairChains(analyzeAntibodies(`>Capla\n${VHH}`).chains);
    expect(abs[0].vhh).toBe(true);
    expect(claimText(abs, { def: "kabat" })[0]).toMatch(/^1\. An isolated single-domain antibody, .* comprises a CDR1 comprising .*, a CDR2 comprising .*, and a CDR3 comprising /);
  });
});

describe("SEQ ID NOs: the claims cite the table's numbers", () => {
  test("two antibodies that would share a name get distinct ones, and every claim number is the table's", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["X", VHH], ["X VH", TH], ["X VL", TL])).chains);
    expect(abs.map((x) => x.name)).toEqual(["X", "X (2)"]);
    const ids = seqIds(abs, "kabat", 1);
    const claims = claimText(abs, { def: "kabat" });
    const id = (ab: number, role: string) => ids.find((s) => s.ab === ab && s.role === role)!.id;
    expect(claims[2]).toContain(`HCDR1 comprising the amino acid sequence of SEQ ID NO: ${id(1, "HCDR1")}`);
    expect(claims[2]).toContain(`LCDR3 comprising the amino acid sequence of SEQ ID NO: ${id(1, "LCDR3")}`);
    expect(claims[3]).toContain(`SEQ ID NO: ${id(1, "VH")} and the VL comprises the amino acid sequence of SEQ ID NO: ${id(1, "VL")}`);
    expect(ids.find((s) => s.id === id(1, "VH"))!.seq).toBe(TH);
  });
  test("names are unique: X, X, X (2) become X, X (3), X (2)", () => {
    const a = analyzeAntibodies(fasta(["X", TH], ["X", PH], ["X (2)", TL]));
    expect(a.chains.map((c) => c.name)).toEqual(["X", "X (3)", "X (2)"]);
  });
  test("a CDR under four residues gets no SEQ ID NO (ST.26) and is written out in the claim", () => {
    const abs = pairChains(analyzeAntibodies(fasta(["T VH", TH], ["T VL", TL])).chains);
    const ids = seqIds(abs, "imgt", 1);
    expect(ids.some((s) => s.seq === "SAS")).toBe(false);
    expect(ids.every((s) => s.seq.length >= 4)).toBe(true);
    const c = claimText(abs, { def: "imgt" })[0];
    expect(c).toContain("an LCDR2 comprising the amino acid sequence SAS,");
    // The numbers stay consecutive around the gap.
    expect(ids.map((s) => s.id)).toEqual(ids.map((_, i) => i + 1));
  });
});

describe("numbering the review found wrong", () => {
  const h3 = (cdr: string) => TH.replace("WGGDGFYAMDY", cdr);
  test("a W-G-x-G inside CDR-H3 is not framework 4", () => {
    for (const cdr of ["DRYWGSGYFDY", "GGSWGSGSYYYYGMDV"]) {
      const r = ok(h3(cdr));
      expect(r.cdrs.kabat.cdr3.seq).toBe(cdr);
      expect(r.cdrs.imgt.cdr3.seq).toBe(`SR${cdr}`);
      expect(r.notes.join(" ")).not.toMatch(/after framework 4/);
    }
  });
  test("a VHH reading W-Y-R-Q with a short H3 is a heavy chain", () => {
    const seq = VHH.replace("WFRQ", "WYRQ").replace(/YYCAA.*WGQG/, "YYCAAAGRYSPDYWGQG");
    const r = ok(seq);
    expect(r.chain).toBe("H");
    expect(r.cdrs.kabat.cdr3.seq).toBe("AGRYSPDY");
    expect(r.notes).toEqual([]);
  });
  test("Kabat H3s of 39 and 40 residues number", () => {
    for (const len of [39, 40]) {
      const cdr = "DRY" + "S".repeat(len - 6) + "FDY";
      const r = ok(h3(cdr));
      expect(r.cdrs.kabat.cdr3.seq).toBe(cdr);
    }
  });
  test("λ chains starting Q-T-V-V / Q-A-V-V and ending T-Q-L-T-A-L are λ, numbered without L10", () => {
    const lam = "QTVVTQEPSLTVSPGGTVTLTCASSTGAVTSGYYPNWFQQKPGQAPRALIYSTSNKHSWTPARFSGSLLGGKAALTLSGVQPEDEAEYYCLLYYGGAQAVFGGGTQLTAL";
    for (const s of [lam, lam.replace(/^QTVV/, "QAVV")]) {
      const r = ok(s);
      expect(r.chain).toBe("L");
      expect(r.numbering.kabat.slice(0, 10)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "11"]);
      expect(r.notes.join(" ")).not.toMatch(/starts at Kabat/);
    }
  });
  test("a T-cell receptor β chain is said to be one", () => {
    const tcr = "NAGVTQTPKFQVLKTGQSMTLQCAQDMNHEYMSWYRQDPGMGLRLIHYSVGAGITDQGEVPNGYNVSRSTTEDFPLRLLSAAPSQTSVYFCASSYVGNTGELFFGEGSRLTVL";
    const a = analyzeAntibodies(`>1G4 beta\n${tcr}`);
    expect(a.notes.join(" ")).toMatch(/reads like a T-cell receptor β chain .* not an antibody/);
  });
  test("four domains in one sequence are four chains, each keeping its own notes", () => {
    const a = analyzeAntibodies(`>q\n${TH}${LINKER}${TL}${LINKER}${PH}${LINKER}${PL}`);
    expect(a.chains.map((c) => [c.name, c.r.domain])).toEqual([
      ["q (1)", TH],
      ["q (2)", TL],
      ["q (3)", PH],
      ["q (4)", PL],
    ]);
    expect(a.notes[0]).toMatch(/^q: four variable domains in one sequence/);
    expect(a.notes.join(" ")).not.toMatch(/signal peptide|constant region/);
  });
  test("one residue past framework 4 is “1 residue”", () => {
    expect(ok(TL + "R").notes).toContain("1 residue after framework 4 (the constant region?) left out of the numbering.");
  });
});

describe("parsing", () => {
  test("a stop inside the sequence is refused; one at the end is not", () => {
    expect(numberChain(TH + "*").ok).toBe(true);
    const r = numberChain(TH.slice(0, 60) + "*" + TH.slice(60));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/stop \(“\*”\) inside the sequence/);
  });
  test("a name with no sequence is listed; a blank line inside a named record does not split it", () => {
    const p = parseEntries(`>A\n>B\n${TH.slice(0, 60)}\n\n${TH.slice(60)}`);
    expect(p.empty).toEqual(["A"]);
    expect(p.entries).toEqual([{ name: "B", seq: TH }]);
    expect(analyzeAntibodies(`>A\n>B\n${TH}`).notes[0]).toBe("A: no sequence under this name — left out.");
  });
});
