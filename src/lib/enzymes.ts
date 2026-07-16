// Restriction enzymes — recognition sites, cut positions and overhangs.
//
// ---------------------------------------------------------------------------
// PROVENANCE — this matters, and it is deliberate.
//
// This table is compiled INDEPENDENTLY from the freely published catalogues and
// technical literature of the enzyme suppliers (NEB, Thermo Scientific, Promega,
// Takara), cross-checked between them. It is NOT copied from REBASE.
//
// Why: an individual recognition sequence is a FACT — "EcoRI cuts G^AATTC" is
// published in every catalogue and textbook, and facts carry no copyright
// (Feist v. Rural Telephone). But a database's SELECTION AND ARRANGEMENT can
// carry a thin copyright, and REBASE's file is distributed "All rights
// reserved". Copying it wholesale would copy the compilation, not just the
// facts. So the selection here is our own — chosen by what people actually use
// for cloning — and each sequence was verified against supplier documentation.
//
// If you extend this table: verify against a supplier catalogue, not REBASE.
// ---------------------------------------------------------------------------
//
// Cut notation follows the universal convention:
//   G^AATTC      cuts after position 1 on the top strand (5' overhang AATT)
//   GTGCA^G      cuts after position 5 (3' overhang)
//   CCC^GGG      cuts in the middle (blunt)
//   GGTCTC(1/5)  Type IIS — cuts OUTSIDE the site, 1 nt away on the top strand
//                and 5 on the bottom
//
// Pure data + pure matching. No DOM, no Office.

/** IUPAC ambiguity codes → the bases they stand for. */
export const IUPAC: Record<string, string> = {
  A: "A",
  C: "C",
  G: "G",
  T: "T",
  R: "AG",
  Y: "CT",
  S: "CG",
  W: "AT",
  K: "GT",
  M: "AC",
  B: "CGT",
  D: "AGT",
  H: "ACT",
  V: "ACG",
  N: "ACGT",
};

export type OverhangKind = "5'" | "3'" | "blunt";

export interface Enzyme {
  name: string;
  /** Recognition sequence, IUPAC codes allowed. No cut marks. */
  site: string;
  /**
   * Cut offset on the TOP strand, counted from the start of the recognition
   * site. For Type IIS this is past the end of the site.
   */
  cutTop: number;
  /** Cut offset on the BOTTOM strand, same coordinate frame. */
  cutBottom: number;
  /** True for Type IIS enzymes, which cut outside their recognition site. */
  typeIIS?: boolean;
  /** Enzymes recognising the same site (informational). */
  isoschizomers?: string[];
  /**
   * How DNA methylation affects this enzyme. Omitted means "not known to be
   * affected by the three methylases below".
   *
   * WHY THIS EXISTS. Without it the table was not merely incomplete, it was
   * misleading in ways that cost a bench week:
   *
   *  - MboI, Sau3AI and DpnI all read GATC and were listed as plain isoschizomers
   *    with identical behaviour. In reality they are THE textbook discrimination
   *    set: MboI is BLOCKED by Dam, Sau3AI ignores Dam, and DpnI cuts ONLY when
   *    Dam has methylated the site.
   *  - DpnI's whole purpose is site-directed mutagenesis: digest the methylated
   *    parental plasmid, leave the unmethylated PCR product intact. Predicting
   *    that it cuts a PCR product is exactly backwards.
   *  - MboI on plasmid DNA from any ordinary dam+ E. coli strain cuts NOTHING.
   *    The table predicted a full digest.
   *  - MspI and HpaII were byte-identical records. The pair exists ONLY because
   *    HpaII is blocked by CpG methylation and MspI is not — that is the basis of
   *    every methylation-sensitive assay. Identical entries made the pair
   *    pointless.
   *
   * Facts, not a compilation: every supplier catalogue states these.
   */
  methylation?: {
    /** Dam methylates the A of GATC (E. coli K-12 is dam+ unless engineered). */
    dam?: MethylEffect;
    /** Dcm methylates the second C of CCWGG. */
    dcm?: MethylEffect;
    /** CpG methylation (mammalian genomic DNA, or M.SssI in vitro). */
    cpg?: MethylEffect;
  };
}

/**
 * - `blocked`      — methylation prevents cutting, always (the site itself is,
 *                    or always contains, the methylase target).
 * - `blocked-in-context` — only blocked when the recognition site happens to
 *                    OVERLAP a methylase site in this particular sequence. Must be
 *                    checked against the actual DNA, not asserted from the enzyme.
 * - `required`     — cuts ONLY the methylated form (DpnI).
 * - `insensitive`  — explicitly unaffected. Worth stating: it is the reason to
 *                    choose this enzyme over its isoschizomer.
 */
export type MethylEffect = "blocked" | "blocked-in-context" | "required" | "insensitive";

/**
 * The enzyme table.
 *
 * Selected for what people actually use: the standard cloning six-cutters, the
 * rare-cutters used for large constructs, the frequent-cutters used for
 * fingerprinting, the degenerate-site enzymes, and the Type IIS enzymes that
 * modern Golden Gate assembly depends on.
 */
export const ENZYMES: Enzyme[] = [
  // --- Standard 6-cutters, 5' overhang ------------------------------------
  { name: "EcoRI", site: "GAATTC", cutTop: 1, cutBottom: 5 },
  { name: "BamHI", site: "GGATCC", cutTop: 1, cutBottom: 5 },
  { name: "HindIII", site: "AAGCTT", cutTop: 1, cutBottom: 5 },
  { name: "XhoI", site: "CTCGAG", cutTop: 1, cutBottom: 5 },
  { name: "SalI", site: "GTCGAC", cutTop: 1, cutBottom: 5 },
  { name: "XbaI", site: "TCTAGA", cutTop: 1, cutBottom: 5, methylation: { dam: "blocked-in-context" } },
  { name: "BglII", site: "AGATCT", cutTop: 1, cutBottom: 5 },
  { name: "SpeI", site: "ACTAGT", cutTop: 1, cutBottom: 5 },
  { name: "NheI", site: "GCTAGC", cutTop: 1, cutBottom: 5 },
  { name: "AflII", site: "CTTAAG", cutTop: 1, cutBottom: 5 },
  { name: "AgeI", site: "ACCGGT", cutTop: 1, cutBottom: 5 },
  { name: "AvrII", site: "CCTAGG", cutTop: 1, cutBottom: 5 },
  // TGATCA always contains GATC, so Dam always blocks it — no context needed.
  { name: "BclI", site: "TGATCA", cutTop: 1, cutBottom: 5, methylation: { dam: "blocked" } },
  { name: "BspEI", site: "TCCGGA", cutTop: 1, cutBottom: 5 },
  { name: "BsrGI", site: "TGTACA", cutTop: 1, cutBottom: 5 },
  { name: "MfeI", site: "CAATTG", cutTop: 1, cutBottom: 5 },
  { name: "MluI", site: "ACGCGT", cutTop: 1, cutBottom: 5 },
  { name: "EagI", site: "CGGCCG", cutTop: 1, cutBottom: 5 },
  { name: "NcoI", site: "CCATGG", cutTop: 1, cutBottom: 5 },
  { name: "PciI", site: "ACATGT", cutTop: 1, cutBottom: 5, isoschizomers: ["AflIII"] },
  { name: "BspHI", site: "TCATGA", cutTop: 1, cutBottom: 5 },
  { name: "StyI", site: "CCWWGG", cutTop: 1, cutBottom: 5 },
  { name: "Acc65I", site: "GGTACC", cutTop: 1, cutBottom: 5, isoschizomers: ["KpnI (3' overhang)"] },
  { name: "BsiWI", site: "CGTACG", cutTop: 1, cutBottom: 5 },
  { name: "XmaI", site: "CCCGGG", cutTop: 1, cutBottom: 5, isoschizomers: ["SmaI (blunt)", "TspMI"] },
  { name: "BssHII", site: "GCGCGC", cutTop: 1, cutBottom: 5 },
  { name: "AscI", site: "GGCGCGCC", cutTop: 2, cutBottom: 6 },
  { name: "NotI", site: "GCGGCCGC", cutTop: 2, cutBottom: 6 },
  { name: "NdeI", site: "CATATG", cutTop: 2, cutBottom: 4 },
  { name: "ClaI", site: "ATCGAT", cutTop: 2, cutBottom: 4, methylation: { dam: "blocked-in-context" } },
  { name: "BstBI", site: "TTCGAA", cutTop: 2, cutBottom: 4 },
  { name: "AsiSI", site: "GCGATCGC", cutTop: 5, cutBottom: 3 },

  // --- 6-cutters, 3' overhang ---------------------------------------------
  { name: "PstI", site: "CTGCAG", cutTop: 5, cutBottom: 1 },
  { name: "SacI", site: "GAGCTC", cutTop: 5, cutBottom: 1 },
  { name: "KpnI", site: "GGTACC", cutTop: 5, cutBottom: 1 },
  { name: "SphI", site: "GCATGC", cutTop: 5, cutBottom: 1 },
  { name: "NsiI", site: "ATGCAT", cutTop: 5, cutBottom: 1 },
  { name: "AatII", site: "GACGTC", cutTop: 5, cutBottom: 1 },
  { name: "ApaI", site: "GGGCCC", cutTop: 5, cutBottom: 1 },
  { name: "Bsp1286I", site: "GDGCHC", cutTop: 5, cutBottom: 1 },
  { name: "SbfI", site: "CCTGCAGG", cutTop: 6, cutBottom: 2 },
  { name: "FseI", site: "GGCCGGCC", cutTop: 6, cutBottom: 2 },
  { name: "PacI", site: "TTAATTAA", cutTop: 5, cutBottom: 3 },

  // --- Blunt cutters -------------------------------------------------------
  { name: "SmaI", site: "CCCGGG", cutTop: 3, cutBottom: 3, methylation: { cpg: "blocked" } },
  { name: "EcoRV", site: "GATATC", cutTop: 3, cutBottom: 3 },
  { name: "PvuII", site: "CAGCTG", cutTop: 3, cutBottom: 3 },
  { name: "ScaI", site: "AGTACT", cutTop: 3, cutBottom: 3 },
  { name: "StuI", site: "AGGCCT", cutTop: 3, cutBottom: 3, methylation: { dcm: "blocked-in-context" } },
  { name: "HpaI", site: "GTTAAC", cutTop: 3, cutBottom: 3 },
  { name: "DraI", site: "TTTAAA", cutTop: 3, cutBottom: 3 },
  { name: "SspI", site: "AATATT", cutTop: 3, cutBottom: 3 },
  { name: "NaeI", site: "GCCGGC", cutTop: 3, cutBottom: 3 },
  { name: "MscI", site: "TGGCCA", cutTop: 3, cutBottom: 3 },
  { name: "SnaBI", site: "TACGTA", cutTop: 3, cutBottom: 3 },
  { name: "PmlI", site: "CACGTG", cutTop: 3, cutBottom: 3 },
  { name: "ZraI", site: "GACGTC", cutTop: 3, cutBottom: 3, isoschizomers: ["AatII (3' overhang)"] },
  { name: "NruI", site: "TCGCGA", cutTop: 3, cutBottom: 3, methylation: { dam: "blocked-in-context" } },
  { name: "HincII", site: "GTYRAC", cutTop: 3, cutBottom: 3 },
  { name: "PmeI", site: "GTTTAAAC", cutTop: 4, cutBottom: 4 },
  { name: "SwaI", site: "ATTTAAAT", cutTop: 4, cutBottom: 4 },
  { name: "SrfI", site: "GCCCGGGC", cutTop: 4, cutBottom: 4 },
  { name: "EcoICRI", site: "GAGCTC", cutTop: 3, cutBottom: 3, isoschizomers: ["SacI (3' overhang)"] },
  { name: "BsaAI", site: "YACGTR", cutTop: 3, cutBottom: 3 },

  // --- Frequent cutters (fingerprinting, mapping) --------------------------
  { name: "AluI", site: "AGCT", cutTop: 2, cutBottom: 2 },
  { name: "HaeIII", site: "GGCC", cutTop: 2, cutBottom: 2 },
  { name: "RsaI", site: "GTAC", cutTop: 2, cutBottom: 2 },
  { name: "MseI", site: "TTAA", cutTop: 1, cutBottom: 3 },
  // MspI/HpaII differ ONLY in CpG sensitivity — that difference is the basis of
  // every methylation-sensitive restriction assay. Identical records made the
  // pair pointless.
  { name: "MspI", site: "CCGG", cutTop: 1, cutBottom: 3, isoschizomers: ["HpaII"],
    methylation: { cpg: "insensitive" } },
  { name: "HpaII", site: "CCGG", cutTop: 1, cutBottom: 3, isoschizomers: ["MspI"],
    methylation: { cpg: "blocked" } },
  { name: "TaqI", site: "TCGA", cutTop: 1, cutBottom: 3, methylation: { dam: "blocked-in-context" } },
  // The GATC trio below is the classic Dam-discrimination set. Same site, three
  // different answers on the same DNA — which is the ONLY reason to list all three.
  { name: "MboI", site: "GATC", cutTop: 0, cutBottom: 4, isoschizomers: ["Sau3AI", "DpnII"],
    methylation: { dam: "blocked" } },
  { name: "Sau3AI", site: "GATC", cutTop: 0, cutBottom: 4, isoschizomers: ["MboI", "DpnII"],
    methylation: { dam: "insensitive" } },
  // DpnI cuts ONLY G-m6A-TC. This is why site-directed mutagenesis works: it
  // destroys the Dam-methylated parental plasmid and leaves the unmethylated PCR
  // product whole. Predicting that it digests a PCR product is exactly backwards.
  { name: "DpnI", site: "GATC", cutTop: 2, cutBottom: 2, isoschizomers: ["MboI", "Sau3AI"],
    methylation: { dam: "required" } },
  { name: "HhaI", site: "GCGC", cutTop: 3, cutBottom: 1 },
  { name: "HinfI", site: "GANTC", cutTop: 1, cutBottom: 4 },
  { name: "NlaIII", site: "CATG", cutTop: 4, cutBottom: 0 },
  { name: "BfaI", site: "CTAG", cutTop: 1, cutBottom: 3 },
  { name: "CviQI", site: "GTAC", cutTop: 1, cutBottom: 3, isoschizomers: ["RsaI (blunt)"] },
  { name: "NspI", site: "RCATGY", cutTop: 5, cutBottom: 1 },

  // --- Degenerate / interrupted sites -------------------------------------
  // These are the ones a plain string search cannot find at all.
  { name: "BstXI", site: "CCANNNNNNTGG", cutTop: 8, cutBottom: 4 },
  { name: "SfiI", site: "GGCCNNNNNGGCC", cutTop: 8, cutBottom: 5 },
  { name: "DraIII", site: "CACNNNGTG", cutTop: 6, cutBottom: 3 },
  { name: "AlwNI", site: "CAGNNNCTG", cutTop: 6, cutBottom: 3 },
  { name: "XcmI", site: "CCANNNNNNNNNTGG", cutTop: 8, cutBottom: 7 },
  { name: "BglI", site: "GCCNNNNNGGC", cutTop: 7, cutBottom: 4 },
  { name: "PflMI", site: "CCANNNNNTGG", cutTop: 7, cutBottom: 4 },
  { name: "Bsu36I", site: "CCTNAGG", cutTop: 2, cutBottom: 5 },
  { name: "BstEII", site: "GGTNACC", cutTop: 1, cutBottom: 6 },
  { name: "EcoO109I", site: "RGGNCCY", cutTop: 2, cutBottom: 5 },
  { name: "AhdI", site: "GACNNNNNGTC", cutTop: 6, cutBottom: 5 },
  { name: "DrdI", site: "GACNNNNNNGTC", cutTop: 7, cutBottom: 5 },
  { name: "XmnI", site: "GAANNNNTTC", cutTop: 5, cutBottom: 5 },
  { name: "BsaWI", site: "WCCGGW", cutTop: 1, cutBottom: 5 },
  { name: "SgrAI", site: "CRCCGGYG", cutTop: 2, cutBottom: 6 },
  { name: "ApaLI", site: "GTGCAC", cutTop: 1, cutBottom: 5 },
  { name: "AseI", site: "ATTAAT", cutTop: 2, cutBottom: 4 },
  { name: "Tth111I", site: "GACNNNGTC", cutTop: 4, cutBottom: 5 },
  { name: "EcoNI", site: "CCTNNNNNAGG", cutTop: 5, cutBottom: 6 },
  { name: "BsaBI", site: "GATNNNNATC", cutTop: 5, cutBottom: 5 },
  { name: "BstAPI", site: "GCANNNNNTGC", cutTop: 7, cutBottom: 4 },
  { name: "PflFI", site: "GACNNNGTC", cutTop: 4, cutBottom: 5 },
  { name: "BciVI", site: "GTATCC", cutTop: 12, cutBottom: 10, typeIIS: true },

  // --- Type IIS — cut OUTSIDE the recognition site -------------------------
  // These power Golden Gate assembly. They are ASYMMETRIC, so a forward-only
  // search misses every site on the reverse strand.
  { name: "BsaI", site: "GGTCTC", cutTop: 7, cutBottom: 11, typeIIS: true, isoschizomers: ["Eco31I"] },
  { name: "BsmBI", site: "CGTCTC", cutTop: 7, cutBottom: 11, typeIIS: true, isoschizomers: ["Esp3I"] },
  { name: "Esp3I", site: "CGTCTC", cutTop: 7, cutBottom: 11, typeIIS: true, isoschizomers: ["BsmBI"] },
  { name: "BbsI", site: "GAAGAC", cutTop: 8, cutBottom: 12, typeIIS: true, isoschizomers: ["BpiI"] },
  { name: "SapI", site: "GCTCTTC", cutTop: 8, cutBottom: 11, typeIIS: true, isoschizomers: ["BspQI", "LguI"] },
  { name: "BspQI", site: "GCTCTTC", cutTop: 8, cutBottom: 11, typeIIS: true, isoschizomers: ["SapI"] },
  { name: "AarI", site: "CACCTGC", cutTop: 11, cutBottom: 15, typeIIS: true },
  { name: "BsmAI", site: "GTCTC", cutTop: 6, cutBottom: 10, typeIIS: true },
  { name: "BspMI", site: "ACCTGC", cutTop: 10, cutBottom: 14, typeIIS: true, isoschizomers: ["BfuAI"] },
  { name: "BtgZI", site: "GCGATG", cutTop: 16, cutBottom: 20, typeIIS: true },
  { name: "FokI", site: "GGATG", cutTop: 14, cutBottom: 18, typeIIS: true },
  { name: "HgaI", site: "GACGC", cutTop: 10, cutBottom: 15, typeIIS: true },
  { name: "MlyI", site: "GAGTC", cutTop: 10, cutBottom: 10, typeIIS: true },
  { name: "PleI", site: "GAGTC", cutTop: 9, cutBottom: 13, typeIIS: true },
  { name: "AlwI", site: "GGATC", cutTop: 9, cutBottom: 10, typeIIS: true },
  { name: "MmeI", site: "TCCRAC", cutTop: 26, cutBottom: 24, typeIIS: true },
  { name: "BsgI", site: "GTGCAG", cutTop: 22, cutBottom: 20, typeIIS: true },
  { name: "BpmI", site: "CTGGAG", cutTop: 22, cutBottom: 20, typeIIS: true },
  { name: "BpuEI", site: "CTTGAG", cutTop: 22, cutBottom: 20, typeIIS: true },
  { name: "EcoP15I", site: "CAGCAG", cutTop: 31, cutBottom: 33, typeIIS: true },
];

/** Reverse complement, IUPAC-aware. */
const COMPLEMENT: Record<string, string> = {
  A: "T", T: "A", G: "C", C: "G",
  R: "Y", Y: "R", S: "S", W: "W",
  K: "M", M: "K", B: "V", V: "B",
  D: "H", H: "D", N: "N",
};

export function reverseComplementIupac(s: string): string {
  let out = "";
  for (let i = s.length - 1; i >= 0; i--) out += COMPLEMENT[s[i]] ?? "N";
  return out;
}

/** True when a recognition site reads the same on both strands. */
export function isPalindromic(site: string): boolean {
  return reverseComplementIupac(site) === site;
}

/** Does `base` satisfy IUPAC `code`? */
function baseMatches(code: string, base: string): boolean {
  const allowed = IUPAC[code];
  return allowed ? allowed.indexOf(base) >= 0 : false;
}

/** Does `site` match `seq` starting at `at`? IUPAC-aware. */
function siteMatchesAt(seq: string, at: number, site: string): boolean {
  if (at + site.length > seq.length) return false;
  for (let i = 0; i < site.length; i++) {
    if (!baseMatches(site[i], seq[at + i])) return false;
  }
  return true;
}

export interface EnzymeHit {
  enzyme: string;
  /** The recognition site as written in the table. */
  site: string;
  /** 1-based position where the recognition site starts. */
  position: number;
  /** Which strand the recognition site was found on. */
  strand: 1 | -1;
  /** 1-based position of the top-strand cut. */
  cutPosition: number;
  overhang: OverhangKind;
  /** Overhang length in nt (0 for blunt). */
  overhangLength: number;
  typeIIS?: boolean;
}

/** The overhang a cut produces, from the two cut offsets. */
export function overhangOf(e: Enzyme): { kind: OverhangKind; length: number } {
  const d = e.cutBottom - e.cutTop;
  if (d === 0) return { kind: "blunt", length: 0 };
  return d > 0 ? { kind: "5'", length: d } : { kind: "3'", length: -d };
}

export interface FindOptions {
  /** Treat the sequence as circular, so sites spanning the origin are found. */
  circular?: boolean;
  /** Only these enzymes (by name). Default: all. */
  only?: string[];
}

/** Where a methylase acts, and what it methylates. Facts from any catalogue. */
export const METHYLASES = {
  dam: { site: "GATC", what: "the A of GATC", who: "Dam (E. coli K-12 is dam+ unless engineered)" },
  dcm: { site: "CCWGG", what: "the second C of CCWGG", who: "Dcm (E. coli K-12 is dcm+)" },
  cpg: { site: "CG", what: "the C of CG", who: "CpG methylation (mammalian genomic DNA, or M.SssI)" },
} as const;

export type MethylaseName = keyof typeof METHYLASES;

/** A methylation problem at a specific site in a specific sequence. */
export interface MethylationWarning {
  enzyme: string;
  /** 1-based start of the affected recognition site. */
  position: number;
  methylase: MethylaseName;
  effect: MethylEffect;
  message: string;
}

/** True if `seq` matches the IUPAC pattern `pat` at `i` (no wraparound). */
function matchesAt(seq: string, pat: string, i: number): boolean {
  if (i < 0 || i + pat.length > seq.length) return false;
  for (let k = 0; k < pat.length; k++) {
    const allowed = IUPAC[pat[k]];
    if (!allowed || !allowed.includes(seq[i + k])) return false;
  }
  return true;
}

/**
 * Does a methylase site OVERLAP the window [start, end) of `seq`?
 *
 * This is what makes "blocked-in-context" a statement about the DNA rather than
 * about the enzyme. ClaI (ATCGAT) is only Dam-blocked when the surrounding bases
 * make a GATC across its edge — e.g. ...GATCGAT... — so it must be checked
 * against the actual sequence. Asserting it from the enzyme alone would warn on
 * every ClaI site, which is noise the user would learn to ignore.
 */
function methylaseOverlaps(seq: string, start: number, end: number, m: MethylaseName, circular: boolean): boolean {
  const pat = METHYLASES[m].site;
  const s = circular ? seq + seq.slice(0, pat.length - 1) : seq;
  const from = Math.max(0, start - (pat.length - 1));
  const to = Math.min(s.length - pat.length, end - 1);
  for (let i = from; i <= to; i++) if (matchesAt(s, pat, i)) return true;
  return false;
}

/**
 * Methylation problems for the hits found in `seq`.
 *
 * A digest predicted without this is confidently wrong in the most expensive way:
 * MboI on plasmid DNA from an ordinary dam+ strain cuts NOTHING, and DpnI cuts
 * ONLY methylated DNA — so predicting that it digests a PCR product is exactly
 * backwards. Neither failure announces itself; you just get an undigested gel and
 * lose a week.
 */
export function methylationWarnings(seq: string, hits: EnzymeHit[], circular = false): MethylationWarning[] {
  const clean = seq.toUpperCase().replace(/[^A-Z]/g, "");
  const out: MethylationWarning[] = [];
  const byName = new Map(ENZYMES.map((e) => [e.name, e]));

  for (const h of hits) {
    const e = byName.get(h.enzyme);
    if (!e?.methylation) continue;
    const start = h.position - 1;
    const end = start + e.site.length;

    for (const m of Object.keys(e.methylation) as MethylaseName[]) {
      const effect = e.methylation[m];
      if (!effect || effect === "insensitive") continue;
      const meta = METHYLASES[m];

      if (effect === "required") {
        out.push({
          enzyme: h.enzyme, position: h.position, methylase: m, effect,
          message:
            `${h.enzyme} cuts ONLY when ${meta.what} is methylated. On unmethylated DNA — ` +
            `a PCR product, or DNA from a ${m}− strain — it will not cut at all. That is the ` +
            `point of it: in site-directed mutagenesis it destroys the methylated parental ` +
            `plasmid and leaves your PCR product intact.`,
        });
        continue;
      }

      // "blocked" is unconditional; "blocked-in-context" must be proven against
      // this sequence, or the warning is noise on every site.
      if (effect === "blocked-in-context" && !methylaseOverlaps(clean, start, end, m, circular)) continue;

      out.push({
        enzyme: h.enzyme, position: h.position, methylase: m, effect,
        message:
          `${h.enzyme} at ${h.position} is BLOCKED by ${meta.who}, which methylates ${meta.what}` +
          `${effect === "blocked-in-context" ? " — and this site overlaps one" : ""}. ` +
          `It will not cut DNA grown in an ordinary ${m}+ host. Use a ${m}− strain, ` +
          `or an isoschizomer that ignores ${m}` +
          `${e.isoschizomers?.length ? ` (try ${e.isoschizomers.join(" or ")})` : ""}.`,
      });
    }
  }
  return out;
}

/**
 * Finds every recognition site in `seq`.
 *
 * Searches BOTH strands. This is not a refinement — it is required for
 * correctness: an asymmetric site (every Type IIS enzyme, and degenerate ones
 * like EcoO109I) appears on the reverse strand at positions a forward-only
 * search never sees. Missing a BsaI site is the difference between a Golden Gate
 * assembly that works and one that doesn't.
 *
 * A palindromic site reads identically on both strands, so it is searched once —
 * otherwise every site would be reported twice.
 */
export function findSites(seq: string, opts: FindOptions = {}): EnzymeHit[] {
  const clean = seq.toUpperCase().replace(/[^A-Z]/g, "");
  if (!clean) return [];
  const n = clean.length;
  // For a circular molecule, a site can span the origin. Searching a doubled
  // sequence finds those; positions past n wrap back.
  const hay = opts.circular ? clean + clean : clean;
  const limit = opts.circular ? n : n;

  const list = opts.only ? ENZYMES.filter((e) => opts.only!.includes(e.name)) : ENZYMES;
  const hits: EnzymeHit[] = [];

  for (const e of list) {
    const { kind, length } = overhangOf(e);
    const palindrome = isPalindromic(e.site);
    const strands: { site: string; strand: 1 | -1 }[] = palindrome
      ? [{ site: e.site, strand: 1 }]
      : [
          { site: e.site, strand: 1 },
          { site: reverseComplementIupac(e.site), strand: -1 },
        ];

    for (const { site, strand } of strands) {
      const maxStart = Math.min(hay.length - site.length, limit - 1);
      for (let i = 0; i <= maxStart; i++) {
        if (!siteMatchesAt(hay, i, site)) continue;
        const pos = (i % n) + 1;
        // The top-strand cut, relative to the site's start on the top strand.
        const cut = strand === 1 ? i + e.cutTop : i + site.length - e.cutTop;
        hits.push({
          enzyme: e.name,
          site: e.site,
          position: pos,
          strand,
          cutPosition: ((cut % n) + n) % n || n,
          overhang: kind,
          overhangLength: length,
          typeIIS: e.typeIIS,
        });
      }
    }
  }
  return hits.sort((a, b) => a.position - b.position || a.enzyme.localeCompare(b.enzyme));
}

/** Groups hits by enzyme, for a summary table. */
export function summarise(hits: EnzymeHit[]): { enzyme: string; site: string; count: number; positions: number[]; overhang: OverhangKind }[] {
  const by = new Map<string, EnzymeHit[]>();
  for (const h of hits) {
    const cur = by.get(h.enzyme);
    if (cur) cur.push(h);
    else by.set(h.enzyme, [h]);
  }
  return [...by.entries()]
    .map(([enzyme, hs]) => ({
      enzyme,
      site: hs[0].site,
      count: hs.length,
      positions: hs.map((h) => h.position).sort((a, b) => a - b),
      overhang: hs[0].overhang,
    }))
    .sort((a, b) => a.enzyme.localeCompare(b.enzyme));
}

/** Enzymes cutting exactly once — the ones useful for cloning into a vector. */
export function uniqueCutters(hits: EnzymeHit[]): string[] {
  return summarise(hits)
    .filter((s) => s.count === 1)
    .map((s) => s.enzyme);
}

/** Formats a site with its cut mark, e.g. "G^AATTC" or "GGTCTC(1/5)". */
export function formatSite(e: Enzyme): string {
  if (e.typeIIS || e.cutTop > e.site.length) {
    return `${e.site}(${e.cutTop - e.site.length}/${e.cutBottom - e.site.length})`;
  }
  return e.site.slice(0, e.cutTop) + "^" + e.site.slice(e.cutTop);
}
