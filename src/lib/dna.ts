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

import { ENZYMES, findSites, summarise } from "./enzymes";
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

/** Reverse complement — the opposite strand read 5'→3'. Keeps RNA as RNA (the
 *  complement of A in an RNA sequence is U, not T). */
export function reverseComplement(seq: string): string {
  const isRna = /U/i.test(seq) && !/T/i.test(seq);
  const rc = complement(seq).split("").reverse().join("");
  return isRna ? rc.replace(/T/g, "U") : rc;
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
  /** Melting temperature, °C. Nearest-neighbour unless `method` says otherwise. */
  tm: number;
  /** Which model produced `tm`. */
  method: "nearest-neighbour" | "wallace";
  /** Enthalpy and entropy of duplex formation (NN only): kcal/mol and cal/mol·K. */
  deltaH?: number;
  deltaS?: number;
  caveats: string[];
}

export interface PrimerTmOptions {
  /** Monovalent cation concentration, molar. Default 0.05 M — a typical PCR buffer. */
  sodium?: number;
  /** Total strand concentration, molar. Default 0.25 µM — a typical primer. */
  primer?: number;
}

/**
 * SantaLucia (1998) unified nearest-neighbour parameters.
 *
 * [ΔH kcal/mol, ΔS cal/(mol·K)] for each 5'→3' dinucleotide step, paired with its
 * complement. Duplex stability depends on STACKING between adjacent bases, which is
 * why the ORDER matters and a GC%-only formula cannot work.
 *
 * There are 10 unique values; the other 6 keys are the reverse complements and MUST
 * carry the same numbers (AA/TT stacking is the same interaction read from either
 * strand). primerTmNN.test.ts checks exactly that, because these are transcribed
 * data — the same class as BLOSUM62 and the compound dictionary — and one wrong
 * cell would skew every primer silently.
 */
const NN_PARAMS: Record<string, [number, number]> = {
  AA: [-7.9, -22.2], TT: [-7.9, -22.2],
  AT: [-7.2, -20.4],
  TA: [-7.2, -21.3],
  CA: [-8.5, -22.7], TG: [-8.5, -22.7],
  GT: [-8.4, -22.4], AC: [-8.4, -22.4],
  CT: [-7.8, -21.0], AG: [-7.8, -21.0],
  GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2],
  GC: [-9.8, -24.4],
  GG: [-8.0, -19.9], CC: [-8.0, -19.9],
};

/** Helix initiation, which depends on whether the end is a G·C or an A·T pair. */
const INIT_GC: [number, number] = [0.1, -2.8];
const INIT_AT: [number, number] = [2.3, 4.1];

/** Gas constant, cal/(mol·K). */
const R_CAL = 1.987;

/** True if the oligo is its own reverse complement (changes the concentration term). */
function isSelfComplementary(s: string): boolean {
  const comp: Record<string, string> = { A: "T", T: "A", G: "C", C: "G" };
  if (s.length % 2 !== 0) return false;
  for (let i = 0; i < s.length; i++) if (s[i] !== comp[s[s.length - 1 - i]]) return false;
  return true;
}

/**
 * Melting temperature of a primer/oligo by nearest-neighbour thermodynamics
 * (SantaLucia 1998), salt- and concentration-corrected.
 *
 * WHY THIS REPLACED THE OLD METHOD. The previous implementation used the Wallace
 * rule below 14 nt and 64.9 + 41(GC − 16.4)/N above it. Both see only LENGTH and
 * GC COUNT, so they are blind to sequence order — and duplex stability is stacking,
 * which is entirely about order. Measured against NN on 20-mers, the old method was
 * out by up to 7 °C, and not by a constant you could correct for:
 *
 *   GCGCGCGCGCGCGCGCGCGC   old 72.3   NN 79.2   -6.9
 *   ATATATATATATATATATAT   old 31.3   NN 26.3   +4.9
 *   TTTTTTTTTTAAAAAAAAAA   old 31.3   NN 37.2   -5.9
 *
 * Note the last two: same length, same 0% GC, so the old formula gives them the
 * SAME 31.3 °C. They really differ by 11 °C. A Tm wrong by that much is a failed
 * PCR or a smear of non-specific product, and the number looked perfectly ordinary.
 *
 *   Tm = ΔH·1000 / (ΔS + R·ln(CT/x)) − 273.15
 *
 * with x = 4 for the usual non-self-complementary primer and x = 1 when the oligo is
 * its own reverse complement, and the SantaLucia salt correction
 * ΔS' = ΔS + 0.368·(N−1)·ln([Na⁺]).
 */
export function primerTm(seq: string, opts: PrimerTmOptions = {}): PrimerTm {
  const s = seq.toUpperCase().replace(/[^ACGTU]/g, "").replace(/U/g, "T");
  const n = s.length;
  let gc = 0;
  let at = 0;
  for (const ch of s) {
    if (ch === "G" || ch === "C") gc++;
    else at++;
  }
  const gcPercent = n ? (gc / n) * 100 : 0;
  const caveats: string[] = [];

  if (n === 0) return { length: 0, gcPercent: 0, tm: 0, method: "wallace", caveats: ["Empty sequence."] };

  // Below ~8 nt the NN model's initiation terms dominate and the duplex is barely
  // stable; the Wallace rule is the honest answer there, and saying which model
  // produced the number matters more than pretending one covers everything.
  if (n < 8) {
    caveats.push(
      `Only ${n} nt: too short for the nearest-neighbour model to mean much, so this is the ` +
        "Wallace rule (2·AT + 4·GC) — a rule of thumb, not thermodynamics. Expect several °C of error."
    );
    return { length: n, gcPercent, tm: 2 * at + 4 * gc, method: "wallace", caveats };
  }

  const sodium = opts.sodium ?? 0.05;
  const primer = opts.primer ?? 0.25e-6;

  let dH = 0;
  let dS = 0;
  let unknown = 0;
  for (let i = 0; i < n - 1; i++) {
    const p = NN_PARAMS[s.slice(i, i + 2)];
    if (!p) { unknown++; continue; }
    dH += p[0];
    dS += p[1];
  }
  const init = (c: string): [number, number] => (c === "G" || c === "C" ? INIT_GC : INIT_AT);
  const a = init(s[0]);
  const b = init(s[n - 1]);
  dH += a[0] + b[0];
  dS += a[1] + b[1];

  // Salt correction (SantaLucia 1998). Applied to entropy, not to Tm directly.
  dS += 0.368 * (n - 1) * Math.log(sodium);

  const selfComp = isSelfComplementary(s);
  const ctTerm = selfComp ? primer : primer / 4;
  const tm = (dH * 1000) / (dS + R_CAL * Math.log(ctTerm)) - 273.15;

  caveats.push(
    `Nearest-neighbour (SantaLucia 1998) at [Na⁺] ${(sodium * 1000).toFixed(0)} mM and ` +
      `${(primer * 1e6).toFixed(2)} µM primer. Tm moves with BOTH — quoting a Tm without them ` +
      "is meaningless, and different suppliers' calculators assume different defaults."
  );
  if (selfComp) {
    caveats.push("This oligo is self-complementary (its own reverse complement), so it will form a hairpin/dimer with itself. The concentration term is adjusted, but the oligo is a poor primer regardless.");
  }
  caveats.push(
    "Assumes a perfectly matched duplex in a two-state transition. It does not model " +
      "mismatches, dangling ends, hairpins or primer-dimers, and it says nothing about " +
      "whether the primer is SPECIFIC to your template — a perfect Tm on a primer that " +
      "binds in three places will still fail."
  );
  if (sodium > 0 && !opts.sodium) {
    caveats.push("Salt defaults to 50 mM Na⁺ (a typical PCR buffer). Mg²⁺ is NOT accounted for; a high-Mg buffer raises the real Tm above this.");
  }
  if (unknown) caveats.push(`${unknown} dinucleotide step(s) contained a non-ACGT base and were skipped — the Tm is an underestimate.`);

  return { length: n, gcPercent, tm, method: "nearest-neighbour", deltaH: dH, deltaS: dS, caveats };
}

// --- Restriction sites ------------------------------------------------------

/**
 * Common type-II restriction enzymes → recognition sequence (5'→3'). Only
 * enzymes with unambiguous A/C/G/T sites are listed (the finder matches
 * literally; IUPAC-degenerate sites like AccI's GTMKAC are omitted).
 */
export interface RestrictionHit {
  enzyme: string;
  site: string;
  /** 1-based positions of each occurrence. */
  positions: number[];
}

/**
 * The enzyme table, as a name → site map.
 *
 * Kept for backward compatibility. The real table lives in enzymes.ts, which
 * carries cut positions, overhangs, Type IIS enzymes and IUPAC ambiguity codes
 * — none of which a flat name→string map can express.
 */
export const RESTRICTION_ENZYMES: Record<string, string> = (() => {
  // Not Object.fromEntries: the project targets ES2017.
  const out: Record<string, string> = {};
  for (const e of ENZYMES) out[e.name] = e.site;
  return out;
})();

/**
 * Finds restriction sites.
 *
 * Delegates to enzymes.ts, which searches BOTH strands and understands IUPAC
 * ambiguity codes. The previous implementation did a plain forward-only
 * indexOf: that happened to work because every enzyme it knew was palindromic,
 * but it would silently miss every reverse-strand site of an asymmetric enzyme
 * (all Type IIS — BsaI, BsmBI, BbsI) and could not match a degenerate site
 * (DraIII's CACNNNGTG) at all.
 */
export function restrictionSites(seq: string, enzymes?: Record<string, string>): RestrictionHit[] {
  const only = enzymes ? Object.keys(enzymes) : undefined;
  const hits = findSites(seq, { only });
  return summarise(hits).map((s) => ({ enzyme: s.enzyme, site: s.site, positions: s.positions }));
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
