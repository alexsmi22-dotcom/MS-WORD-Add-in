// Antibody numbering against an independent tool. The fixture holds AntPack's Kabat, IMGT and Martin numbering of 23
// public therapeutic V domains (VH, Vκ, Vλ, VHH) and 138 variants of them with CDRs lengthened or shortened: data
// produced by the tool, not its code. Every real chain must agree residue for residue; the variants too, except
// deletions that make a CDR shorter than any natural one, where the tools place the gap by sequence similarity and
// the engine says so.
import * as fs from "fs";
import * as path from "path";
import { cleanSequence, numberChain } from "../antibody";
import { analyzeAntibodies, annotatedHtml, cdrRows, claimText, identity, identityRows, numberingRows, pairChains, parseEntries, regionRows, seqIds } from "../antibodyReport";

type Fx = Record<string, { seq: string; kabat: { numbering: string[]; chain: string }; imgt: { numbering: string[]; chain: string }; martin: { numbering: string[]; chain: string } }>;
const FX: Fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "antibody-numbering.json"), "utf8"));
// IMGT's own notation (112.1) against the tool's letters (112A).
const norm = (p: string) => p.replace(/\.(\d+)$/, (_, d) => String.fromCharCode(64 + Number(d)));
const n = (p: string) => parseInt(p, 10);
// Variants whose CDR-L1 or L2 was shortened below natural length: placement is alignment-dependent.
const CONVENTION = new Set(["adalimumab_L~v2", "rituximab_L~v1", "belimumab_L~v2", "belimumab_L~v5"]);

const TRAS_H = FX.trastuzumab_H.seq, TRAS_L = FX.trastuzumab_L.seq;

describe("numberChain agrees with an independent numbering tool", () => {
  test.each(Object.keys(FX))("%s", (name) => {
    const e = FX[name];
    const r = numberChain(e.seq);
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.chain).toBe(e.kabat.chain);
    if (CONVENTION.has(name)) {
      // The gap's label inside the CDR is the tool's choice; the CDRs themselves (which residues) must still agree.
      const rngK = e.kabat.chain === "H" ? [[31, 35], [50, 65], [95, 102]] : [[24, 34], [50, 56], [89, 97]];
      const wantK = rngK.map(([lo, hi]) => e.seq.split("").filter((_, i) => e.kabat.numbering[i] !== "-" && n(e.kabat.numbering[i]) >= lo && n(e.kabat.numbering[i]) <= hi).join(""));
      expect([r.cdrs.kabat.cdr1.seq, r.cdrs.kabat.cdr2.seq, r.cdrs.kabat.cdr3.seq]).toEqual(wantK);
      return;
    }
    for (const sc of ["kabat", "imgt"] as const) {
      const mine = e.seq.split("").map((_, i) => (i - r.offset >= 0 && i - r.offset < r.domain.length ? norm(r.numbering[sc][i - r.offset]) : "-"));
      expect([sc, mine.join(" ")]).toEqual([sc, e[sc].numbering.join(" ")]);
    }
    // Chothia CDRs equal the tool's Martin (enhanced Chothia) CDRs; only framework insertions differ between the two.
    const H = e.martin.chain === "H";
    const rng = H ? [[26, 32], [52, 56], [95, 102]] : [[24, 34], [50, 56], [89, 97]];
    const want = rng.map(([lo, hi]) => e.seq.split("").filter((_, i) => e.martin.numbering[i] !== "-" && n(e.martin.numbering[i]) >= lo && n(e.martin.numbering[i]) <= hi).join(""));
    expect([r.cdrs.chothia.cdr1.seq, r.cdrs.chothia.cdr2.seq, r.cdrs.chothia.cdr3.seq]).toEqual(want);
  });
});

describe("CDRs by definition", () => {
  test("trastuzumab: the published Kabat, Chothia, IMGT and AbM CDRs", () => {
    const h = numberChain(TRAS_H), l = numberChain(TRAS_L);
    if (!h.ok || !l.ok) throw new Error("refused");
    const seqs = (r: typeof h, d: "kabat" | "chothia" | "imgt" | "abm") => [r.cdrs[d].cdr1.seq, r.cdrs[d].cdr2.seq, r.cdrs[d].cdr3.seq];
    expect(seqs(h, "kabat")).toEqual(["DTYIH", "RIYPTNGYTRYADSVKG", "WGGDGFYAMDY"]);
    expect(seqs(h, "chothia")).toEqual(["GFNIKDT", "YPTNGY", "WGGDGFYAMDY"]);
    expect(seqs(h, "imgt")).toEqual(["GFNIKDTY", "IYPTNGYT", "SRWGGDGFYAMDY"]);
    expect(seqs(h, "abm")).toEqual(["GFNIKDTYIH", "RIYPTNGYTR", "WGGDGFYAMDY"]);
    expect(seqs(l, "kabat")).toEqual(["RASQDVNTAVA", "SASFLYS", "QQHYTTPPT"]);
    expect(seqs(l, "imgt")).toEqual(["QDVNTA", "SAS", "QQHYTTPPT"]);
    expect(h.chain).toBe("H");
    expect(l.chain).toBe("K");
  });
  test("regions tile the domain with no gap or overlap", () => {
    for (const s of [TRAS_H, TRAS_L, FX.avelumab_L.seq, FX.caplacizumab_VHH.seq]) {
      const r = numberChain(s);
      if (!r.ok) throw new Error("refused");
      for (const d of ["kabat", "chothia", "imgt", "abm"] as const) expect(r.regions[d].map((g) => g.seq).join("")).toBe(r.domain);
    }
  });
});

describe("whatever surrounds the domain", () => {
  test("a signal peptide and a constant region are trimmed and said", () => {
    const signal = "MGWSCIILFLVATATGVHS";
    const ch1 = "ASTKGPSVFPLAPSSKSTSGGTAALGCLVKDYFPEPVTVSWNSGALTSGVHTFPAVLQSS";
    const r = numberChain(signal + TRAS_H + ch1);
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.domain).toBe(TRAS_H);
    expect(r.offset).toBe(signal.length);
    expect(r.notes.join(" ")).toMatch(/19 residues before framework 1/);
    expect(r.notes.join(" ")).toMatch(/after framework 4/);
  });
  test("FASTA, spaces, digits and lower case are read; other letters are refused by name", () => {
    expect(cleanSequence(">VH\n1 evqlv esggg\n11 lvqpg").seq).toBe("EVQLVESGGGLVQPG");
    expect(cleanSequence("EVQLVBZ").errors.join(" ")).toMatch(/“B”, “Z”/);
  });
  test("refusals: too short, too long, not an antibody", () => {
    expect(numberChain("EVQLVESGGG").ok).toBe(false);
    expect(numberChain("A".repeat(1600)).ok).toBe(false);
    const lyso = "KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL";
    const r = numberChain(lyso);
    expect(r.ok).toBe(false);
  });
});

describe("reports", () => {
  const input = `>Tras VH\n${TRAS_H}\n>Tras VL\n${TRAS_L}\n>Pert VH\n${FX.pertuzumab_H.seq}\n>Pert VL\n${FX.pertuzumab_L.seq}\n>Capla\n${FX.caplacizumab_VHH.seq}`;
  const a = analyzeAntibodies(input);
  test("five chains read; the pairs are formed in order; a lone VH is a single-domain antibody", () => {
    expect(a.errors).toEqual([]);
    expect(a.chains.map((c) => c.name)).toEqual(["Tras VH", "Tras VL", "Pert VH", "Pert VL", "Capla"]);
    const abs = pairChains(a.chains);
    expect(abs.map((x) => [x.name, !!x.vh, !!x.vl])).toEqual([["Tras", true, true], ["Pert", true, true], ["Capla", true, false]]);
  });
  test("parseEntries: blank-line blocks and unnamed sequences", () => {
    expect(parseEntries(`${TRAS_H}\n\n${TRAS_L}`).entries.map((e) => e.name)).toEqual(["Sequence 1", "Sequence 2"]);
  });
  test("CDR table and region table", () => {
    const rows = cdrRows(a.chains, "kabat");
    expect(rows[1]).toEqual(["Tras VH", "VH", "DTYIH (H1, 5)", "RIYPTNGYTRYADSVKG (H2, 17)", "WGGDGFYAMDY (H3, 11)"]);
    const reg = regionRows(a.chains[0], "kabat", "kabat");
    expect(reg.map((r) => r[0])).toEqual(["Region", "FR1", "CDR-H1", "FR2", "CDR-H2", "FR3", "CDR-H3", "FR4"]);
    expect(reg[2]).toEqual(["CDR-H1", "Kabat positions", "DTYIH", "5"].map((x, i) => (i === 1 ? "31–35" : x)));
    expect(reg[4][1]).toBe("50–65");
    expect(numberingRows(a.chains[0], "imgt")[1]).toEqual(["E", "1", "1", "1", "FR1"]);
  });
  test("identity: a chain with itself is 100; trastuzumab and pertuzumab VH share their frameworks", () => {
    expect(identity(a.chains[0], a.chains[0], "v", "kabat")).toBe(100);
    const fr = identity(a.chains[0], a.chains[2], "fr", "kabat");
    const cdr = identity(a.chains[0], a.chains[2], "cdr", "kabat");
    expect(fr).toBeGreaterThan(90);
    expect(cdr).toBeLessThan(fr);
    const m = identityRows(a.chains, "v", "kabat");
    expect(m[1][2]).toBe("—"); // VH against VL is not compared
    expect(Number(m[1][3])).toBeGreaterThan(70);
  });
  test("SEQ ID NOs and the claim text cite them, naming the definition", () => {
    const abs = pairChains(a.chains);
    const ids = seqIds(abs, "kabat", 1);
    expect(ids.slice(0, 8).map((s) => s.seq)).toEqual(["DTYIH", "RIYPTNGYTRYADSVKG", "WGGDGFYAMDY", "RASQDVNTAVA", "SASFLYS", "QQHYTTPPT", TRAS_H, TRAS_L]);
    const cl = claimText(abs, { def: "kabat" });
    expect(cl[0]).toMatch(/^1\. An isolated antibody, or antigen-binding fragment thereof, comprising a heavy chain variable region \(VH\) and a light chain variable region \(VL\), wherein the VH comprises an HCDR1 comprising the amino acid sequence of SEQ ID NO: 1, an HCDR2 comprising the amino acid sequence of SEQ ID NO: 2, and an HCDR3 comprising the amino acid sequence of SEQ ID NO: 3; and the VL comprises an LCDR1 comprising the amino acid sequence of SEQ ID NO: 4/);
    expect(cl[0]).toMatch(/wherein the CDRs are defined according to the Kabat numbering scheme\.$/);
    expect(cl[1]).toBe("2. The antibody or antigen-binding fragment of claim 1, wherein the VH comprises the amino acid sequence of SEQ ID NO: 7 and the VL comprises the amino acid sequence of SEQ ID NO: 8.");
    expect(cl[2]).toMatch(/at least 90% identical to SEQ ID NO: 7/);
    expect(cl[6]).toMatch(/^7\. An isolated single-domain antibody/);
    expect(cl[6]).toMatch(/a CDR1 comprising/);
    const spelled = claimText(abs, { def: "imgt", start: 101, spellOut: true });
    expect(spelled[0]).toMatch(/an HCDR1 comprising the amino acid sequence GFNIKDTY \(SEQ ID NO: 101\)/);
    expect(spelled[0]).toMatch(/IMGT numbering scheme/);
  });
  test("annotated sequences: the CDRs and only the CDRs are bold and underlined", () => {
    const html = annotatedHtml([a.chains[0]], "kabat");
    const marked = [...html.matchAll(/<b><u>([A-Z]+)<\/u><\/b>/g)].map((m) => m[1]).join("");
    expect(marked).toBe("DTYIH" + "RIYPTNGYTRYADSVKG" + "WGGDGFYAMDY");
    expect(html).toMatch(/Courier New/);
  });
  test("an scFv (VH–linker–VL) is read as two domains, the linker left out", () => {
    const r = analyzeAntibodies(`>scFv
${TRAS_H}GGGGSGGGGSGGGGS${TRAS_L}`);
    expect(r.chains.map((c) => [c.name, c.r.chain, c.r.domain])).toEqual([["scFv VH", "H", TRAS_H], ["scFv VL", "K", TRAS_L]]);
    expect(r.notes.join(" ")).toMatch(/two variable domains/);
    const rev = analyzeAntibodies(`>rev
${TRAS_L}GGGGSGGGGSGGGGS${TRAS_H}`);
    expect(rev.chains.map((c) => c.r.chain)).toEqual(["K", "H"]);
  });
  test("one bad sequence among good ones is named, the rest still read", () => {
    const r = analyzeAntibodies(`>good\n${TRAS_H}\n>bad\nHELLOWORLD`);
    expect(r.chains.length).toBe(1);
    expect(r.errors.join(" ")).toMatch(/^bad:/);
  });
});
