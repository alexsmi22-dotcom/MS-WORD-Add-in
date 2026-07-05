// DNA/RNA analysis utilities for the task pane's DNA mode: complementary strands,
// transcription, translation (standard genetic code), base composition / GC, and
// a six-frame ORF finder. A companion to Sequence mode (which produces the ST.26
// listing) — this is the analysis side.
//
// Pure string logic — no Office.js — so it is fully unit-testable. Built to be
// robust against real-world input: IUPAC ambiguity codes are accepted throughout,
// degenerate codons are resolved when they map unambiguously to one amino acid,
// and ORF coordinates are reported 1-based on the original (+) strand for both
// strands. Like the rest of the engine, it is a drafting aid — verify downstream.

export type Strand = "+" | "-";

// IUPAC nucleotide complements (DNA + RNA; U complements to A).
const COMPLEMENT: Record<string, string> = {
  A: "T", T: "A", G: "C", C: "G", U: "A",
  R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
  B: "V", V: "B", D: "H", H: "D", N: "N",
};

// IUPAC ambiguity → the concrete bases it stands for.
const IUPAC: Record<string, string[]> = {
  A: ["A"], C: ["C"], G: ["G"], T: ["T"],
  R: ["A", "G"], Y: ["C", "T"], S: ["C", "G"], W: ["A", "T"], K: ["G", "T"], M: ["A", "C"],
  B: ["C", "G", "T"], D: ["A", "G", "T"], H: ["A", "C", "T"], V: ["A", "C", "G"], N: ["A", "C", "G", "T"],
};

const VALID = "ACGTURYSWKMBDHVN";

export interface CleanDnaResult {
  /** Valid bases only, uppercased (U preserved if present). */
  seq: string;
  /** Distinct invalid characters that were dropped, for a UI warning. */
  invalid: string[];
}

/** Strips whitespace/digits/punctuation, uppercases, and keeps valid IUPAC bases. */
export function cleanDna(raw: string): CleanDnaResult {
  const letters = raw.replace(/[^A-Za-z]/g, "").toUpperCase();
  let seq = "";
  const invalid: Record<string, true> = {};
  for (const ch of letters) {
    if (VALID.indexOf(ch) >= 0) seq += ch;
    else invalid[ch] = true;
  }
  return { seq, invalid: Object.keys(invalid) };
}

/** Complement of each base (IUPAC-aware); unknown bases map to N. */
export function complement(seq: string): string {
  return seq
    .toUpperCase()
    .split("")
    .map((c) => COMPLEMENT[c] ?? "N")
    .join("");
}

/** Reverse complement — the opposite strand read 5'→3'. */
export function reverseComplement(seq: string): string {
  return complement(seq).split("").reverse().join("");
}

/** Transcribes a coding (sense) DNA strand to mRNA (T → U). */
export function transcribe(dna: string): string {
  return dna.toUpperCase().replace(/T/g, "U");
}

// Standard genetic code (DNA codons; U is normalized to T before lookup).
const CODON_TABLE: Record<string, string> = {
  TTT: "F", TTC: "F", TTA: "L", TTG: "L",
  CTT: "L", CTC: "L", CTA: "L", CTG: "L",
  ATT: "I", ATC: "I", ATA: "I", ATG: "M",
  GTT: "V", GTC: "V", GTA: "V", GTG: "V",
  TCT: "S", TCC: "S", TCA: "S", TCG: "S",
  CCT: "P", CCC: "P", CCA: "P", CCG: "P",
  ACT: "T", ACC: "T", ACA: "T", ACG: "T",
  GCT: "A", GCC: "A", GCA: "A", GCG: "A",
  TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
  CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
  AAT: "N", AAC: "N", AAA: "K", AAG: "K",
  GAT: "D", GAC: "D", GAA: "E", GAG: "E",
  TGT: "C", TGC: "C", TGA: "*", TGG: "W",
  CGT: "R", CGC: "R", CGA: "R", CGG: "R",
  AGT: "S", AGC: "S", AGA: "R", AGG: "R",
  GGT: "G", GGC: "G", GGA: "G", GGG: "G",
};

/**
 * Resolves a codon (already T-normalized, uppercase) to a one-letter amino acid.
 * Degenerate codons that map to a single amino acid for every concrete expansion
 * are resolved (e.g. GCN → A, CTN → L); otherwise "X". Unknown letters → "X".
 */
export function resolveCodon(codon: string): string {
  if (CODON_TABLE[codon]) return CODON_TABLE[codon];
  const [a, b, c] = codon.split("");
  const as = IUPAC[a];
  const bs = IUPAC[b];
  const cs = IUPAC[c];
  if (!as || !bs || !cs) return "X";
  const aas = new Set<string>();
  for (const x of as) for (const y of bs) for (const z of cs) aas.add(CODON_TABLE[x + y + z] ?? "X");
  return aas.size === 1 ? Array.from(aas)[0] : "X";
}

export interface TranslateOptions {
  /** Reading frame 1, 2, or 3 (offset 0, 1, 2). Default 1. */
  frame?: 1 | 2 | 3;
  /** Stop translating at the first stop codon (omit the "*"). Default false. */
  stopAtStop?: boolean;
}

/**
 * Translates a nucleotide sequence to a one-letter amino-acid string using the
 * standard genetic code. Stop codons render as "*" (unless stopAtStop). RNA (U)
 * is accepted. Incomplete trailing bases are ignored.
 */
export function translate(seq: string, options: TranslateOptions = {}): string {
  const frame = options.frame ?? 1;
  const s = seq.toUpperCase().replace(/U/g, "T");
  let out = "";
  for (let i = frame - 1; i + 3 <= s.length; i += 3) {
    const aa = resolveCodon(s.substring(i, i + 3));
    if (aa === "*") {
      if (options.stopAtStop) break;
      out += "*";
    } else {
      out += aa;
    }
  }
  return out;
}

export interface BaseStats {
  length: number;
  a: number;
  c: number;
  g: number;
  t: number;
  /** Ambiguous / non-ACGT(U) bases counted toward length but not GC/AT. */
  other: number;
  /** (G+C) / (A+C+G+T) × 100, 0 when no concrete bases. */
  gcPercent: number;
  atPercent: number;
}

/** Base composition and GC/AT content. U is counted as T. */
export function baseStats(seq: string): BaseStats {
  const s = seq.toUpperCase().replace(/U/g, "T");
  let a = 0,
    c = 0,
    g = 0,
    t = 0,
    other = 0;
  for (const ch of s) {
    if (ch === "A") a++;
    else if (ch === "C") c++;
    else if (ch === "G") g++;
    else if (ch === "T") t++;
    else other++;
  }
  const acgt = a + c + g + t;
  return {
    length: s.length,
    a,
    c,
    g,
    t,
    other,
    gcPercent: acgt ? (g + c) / acgt * 100 : 0,
    atPercent: acgt ? (a + t) / acgt * 100 : 0,
  };
}

export interface Orf {
  strand: Strand;
  /** Reading frame on that strand, 1–3. */
  frame: number;
  /** 1-based start on the original (+) strand (the lower coordinate). */
  start: number;
  /** 1-based end on the original (+) strand (the higher coordinate, incl. stop). */
  end: number;
  /** Nucleotide length including the stop codon when present. */
  nt: number;
  /** Amino-acid length excluding the stop. */
  aa: number;
  /** Translated protein (one-letter), without the trailing stop. */
  protein: string;
}

export interface OrfOptions {
  /** Minimum protein length in amino acids. Default 1. */
  minAa?: number;
  /** Also scan the reverse-complement strand. Default true. */
  includeReverse?: boolean;
  /** Only report ORFs terminated by a stop codon. Default true. */
  requireStop?: boolean;
}

/**
 * Finds open reading frames (ATG → in-frame stop) across three forward frames and,
 * by default, three reverse frames. Coordinates are 1-based on the original (+)
 * strand for both strands. Per frame, an ORF runs from the first ATG after the
 * previous stop (or frame start) to the next in-frame stop.
 */
export function findOrfs(seq: string, options: OrfOptions = {}): Orf[] {
  const minAa = options.minAa ?? 1;
  const includeReverse = options.includeReverse ?? true;
  const requireStop = options.requireStop ?? true;
  const s = seq.toUpperCase().replace(/U/g, "T");
  const len = s.length;
  const orfs: Orf[] = [];

  const scan = (str: string, strand: Strand): void => {
    for (let f = 0; f < 3; f++) {
      let startIdx = -1;
      for (let i = f; i + 3 <= str.length; i += 3) {
        const codon = str.substring(i, i + 3);
        if (startIdx < 0) {
          if (codon === "ATG") startIdx = i;
        } else if (resolveCodon(codon) === "*") {
          pushOrf(str, startIdx, i + 3, strand, f + 1, true);
          startIdx = -1;
        }
      }
      if (!requireStop && startIdx >= 0) {
        const endExcl = f + Math.floor((str.length - f) / 3) * 3;
        if (endExcl > startIdx) pushOrf(str, startIdx, endExcl, strand, f + 1, false);
      }
    }
  };

  const pushOrf = (
    str: string,
    startIdx: number,
    endExcl: number,
    strand: Strand,
    frame: number,
    hasStop: boolean,
  ): void => {
    const proteinEnd = hasStop ? endExcl - 3 : endExcl;
    const protein = translate(str.substring(startIdx, proteinEnd), { frame: 1 });
    if (protein.length < minAa) return;
    // Map [startIdx, endExcl) on the scanned string to original (+) coordinates.
    const start = strand === "+" ? startIdx + 1 : len - endExcl + 1;
    const end = strand === "+" ? endExcl : len - startIdx;
    orfs.push({ strand, frame, start, end, nt: endExcl - startIdx, aa: protein.length, protein });
  };

  scan(s, "+");
  if (includeReverse) scan(reverseComplement(s), "-");

  return orfs.sort((x, y) => x.start - y.start || x.strand.localeCompare(y.strand) || x.frame - y.frame);
}

// --- Primer / oligo melting temperature -------------------------------------

export interface PrimerTm {
  length: number;
  gcPercent: number;
  tm: number;
}

/**
 * Estimated melting temperature of a primer/oligo — the basic method used by
 * OligoCalc: the Wallace rule (2·AT + 4·GC) for short oligos (<14 nt) and the
 * GC% formula 64.9 + 41·(GC − 16.4)/N for longer ones. It is a quick estimate,
 * not a salt-corrected nearest-neighbor Tm.
 */
export function primerTm(seq: string): PrimerTm {
  const s = seq.toUpperCase().replace(/[^ACGTU]/g, "").replace(/U/g, "T");
  const n = s.length;
  let gc = 0;
  let at = 0;
  for (const ch of s) {
    if (ch === "G" || ch === "C") gc++;
    else at++;
  }
  const tm = n === 0 ? 0 : n < 14 ? 2 * at + 4 * gc : 64.9 + (41 * (gc - 16.4)) / n;
  return { length: n, gcPercent: n ? (gc / n) * 100 : 0, tm };
}

// --- Restriction sites ------------------------------------------------------

/**
 * Common type-II restriction enzymes → recognition sequence (5'→3'). Only
 * enzymes with unambiguous A/C/G/T sites are listed (the finder matches
 * literally; IUPAC-degenerate sites like AccI's GTMKAC are omitted).
 */
export const RESTRICTION_ENZYMES: Record<string, string> = {
  EcoRI: "GAATTC", BamHI: "GGATCC", HindIII: "AAGCTT", NotI: "GCGGCCGC", XhoI: "CTCGAG",
  PstI: "CTGCAG", SmaI: "CCCGGG", KpnI: "GGTACC", SacI: "GAGCTC", SalI: "GTCGAC",
  XbaI: "TCTAGA", NcoI: "CCATGG", NdeI: "CATATG", EcoRV: "GATATC", BglII: "AGATCT",
  SpeI: "ACTAGT", NheI: "GCTAGC", ApaI: "GGGCCC", ClaI: "ATCGAT", HpaI: "GTTAAC",
  AatII: "GACGTC", AflII: "CTTAAG", AgeI: "ACCGGT", AscI: "GGCGCGCC", AvrII: "CCTAGG",
  BclI: "TGATCA", BspEI: "TCCGGA", BsrGI: "TGTACA", BstBI: "TTCGAA", DraI: "TTTAAA",
  EagI: "CGGCCG", FseI: "GGCCGGCC", HaeIII: "GGCC", HhaI: "GCGC", MfeI: "CAATTG",
  MluI: "ACGCGT", MscI: "TGGCCA", NaeI: "GCCGGC", NsiI: "ATGCAT", PacI: "TTAATTAA",
  PmeI: "GTTTAAAC", PvuII: "CAGCTG", RsaI: "GTAC", SbfI: "CCTGCAGG", ScaI: "AGTACT",
  SnaBI: "TACGTA", SspI: "AATATT", StuI: "AGGCCT", SwaI: "ATTTAAAT",
};

export interface RestrictionHit {
  enzyme: string;
  site: string;
  /** 1-based positions of each occurrence. */
  positions: number[];
}

/** Finds occurrences of restriction sites in the sequence (enzymes with ≥1 hit). */
export function restrictionSites(seq: string, enzymes: Record<string, string> = RESTRICTION_ENZYMES): RestrictionHit[] {
  // Search in place (don't strip) so reported positions match the input sequence.
  const s = seq.toUpperCase();
  const hits: RestrictionHit[] = [];
  for (const [enzyme, site] of Object.entries(enzymes)) {
    const positions: number[] = [];
    let i = s.indexOf(site);
    while (i !== -1) {
      positions.push(i + 1);
      i = s.indexOf(site, i + 1);
    }
    if (positions.length) hits.push({ enzyme, site, positions });
  }
  return hits.sort((a, b) => a.enzyme.localeCompare(b.enzyme));
}

// --- Protein properties -----------------------------------------------------

// Average residue masses (Da), from Expasy FindMod; protein MW = Σ residues +
// one water (18.01524, the Expasy average water mass), matching Expasy ProtParam.
// Sec (U) and Pyl (O) aren't in Expasy's table — computed from the periodic table.
const RESIDUE_MASS: Record<string, number> = {
  G: 57.0519, A: 71.0788, S: 87.0782, P: 97.1167, V: 99.1326, T: 101.1051, C: 103.1388, L: 113.1594,
  I: 113.1594, N: 114.1038, D: 115.0886, Q: 128.1307, K: 128.1741, E: 129.1155, M: 131.1926, H: 137.1411,
  F: 147.1766, R: 156.1875, Y: 163.176, W: 186.2132, U: 150.05, O: 237.303,
};
const WATER_MASS = 18.01524;
// Kyte–Doolittle hydropathy.
const HYDROPATHY: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
};
// pKa values from EMBOSS iep's data file (Epk.dat), so the pI matches what the
// iep program computes: N-term 7.5, C-term 3.6, C 8.5, D 3.9, E 4.1, H 6.5,
// K 10.8, R 12.5, Y 10.1. (Note: the N-term differs from the older "EMBOSS
// scale" of 8.6 reproduced in some pI tools; 7.5 is the current shipped value.)
const PKA_POS: Record<string, number> = { Nterm: 7.5, K: 10.8, R: 12.5, H: 6.5 };
const PKA_NEG: Record<string, number> = { Cterm: 3.6, D: 3.9, E: 4.1, C: 8.5, Y: 10.1 };

export interface ProteinProperties {
  length: number;
  /** Molecular weight in daltons. */
  mw: number;
  /** Isoelectric point (estimated). */
  pI: number;
  /** Grand average of hydropathy (Kyte–Doolittle). */
  gravy: number;
}

function netCharge(counts: Record<string, number>, pH: number): number {
  let c = 1 / (1 + Math.pow(10, pH - PKA_POS.Nterm)) - 1 / (1 + Math.pow(10, PKA_NEG.Cterm - pH));
  for (const [r, pKa] of Object.entries(PKA_POS)) {
    if (r === "Nterm") continue;
    c += (counts[r] ?? 0) / (1 + Math.pow(10, pH - pKa));
  }
  for (const [r, pKa] of Object.entries(PKA_NEG)) {
    if (r === "Cterm") continue;
    c -= (counts[r] ?? 0) / (1 + Math.pow(10, pKa - pH));
  }
  return c;
}

/** Molecular weight, isoelectric point, and GRAVY for a one-letter protein sequence. */
export function proteinProperties(aa: string): ProteinProperties {
  const seq = aa.toUpperCase().replace(/[^A-Z]/g, "");
  let mw = WATER_MASS;
  let gravy = 0;
  let gravyN = 0;
  let n = 0;
  const counts: Record<string, number> = {};
  for (const ch of seq) {
    if (RESIDUE_MASS[ch] === undefined) continue;
    mw += RESIDUE_MASS[ch];
    if (HYDROPATHY[ch] !== undefined) {
      gravy += HYDROPATHY[ch];
      gravyN++;
    }
    counts[ch] = (counts[ch] ?? 0) + 1;
    n++;
  }
  if (n === 0) return { length: 0, mw: 0, pI: 0, gravy: 0 };
  // Bisection for the pH where net charge crosses zero.
  let lo = 0;
  let hi = 14;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (netCharge(counts, mid) > 0) lo = mid;
    else hi = mid;
  }
  return {
    length: n,
    mw: Math.round(mw * 100) / 100,
    pI: Math.round(((lo + hi) / 2) * 100) / 100,
    gravy: gravyN ? gravy / gravyN : 0,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CELL = 'style="border:1px solid #000;padding:2px 8px;"';
const HEAD = 'style="border:1px solid #000;padding:2px 8px;font-weight:bold;"';

/** Renders ORFs as an HTML table for Word.Range.insertHtml(). "" when empty. */
export function buildOrfTableHtml(orfs: Orf[]): string {
  if (!orfs.length) return "";
  const rows = orfs
    .map(
      (o) =>
        `<tr><td ${CELL}>${o.strand}</td><td ${CELL}>${o.frame}</td>` +
        `<td ${CELL}>${o.start}..${o.end}</td><td ${CELL}>${o.aa}</td>` +
        `<td ${CELL}>${escapeHtml(o.protein)}</td></tr>`,
    )
    .join("");
  return (
    '<table style="border-collapse:collapse;">' +
    `<tr><td ${HEAD}>Strand</td><td ${HEAD}>Frame</td><td ${HEAD}>Location</td>` +
    `<td ${HEAD}>Length (aa)</td><td ${HEAD}>Protein</td></tr>` +
    rows +
    "</table>"
  );
}
