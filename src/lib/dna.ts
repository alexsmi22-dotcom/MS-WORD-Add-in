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
  /**
   * How many FASTA records were present. More than one means the caller pasted a
   * multi-record file and the sequences were concatenated — which is almost
   * never what they meant, so the UI must warn rather than quietly join them.
   */
  records: number;
}

/** Strips whitespace/digits/punctuation, uppercases, and keeps valid IUPAC bases. */
export function cleanDna(raw: string): CleanDnaResult {
  // Drop FASTA ">" headers and legacy ";" comments BEFORE keeping letters.
  // Without this a header's letters that happen to be IUPAC codes survive into
  // the sequence: a 12 nt insert under a normal NCBI header became 37 nt and
  // shifted GC% from 33.3 to 30.4, silently corrupting reverse complement,
  // translation, ORFs, restriction sites and Tm. The "ignored invalid
  // characters" line made it look handled, because the non-IUPAC header letters
  // were reported there.
  const records = (raw.match(/^>/gm) ?? []).length;
  const body = raw.replace(/^[>;].*$/gm, " ");
  const letters = body.replace(/[^A-Za-z]/g, "").toUpperCase();
  let seq = "";
  const invalid: Record<string, true> = {};
  for (const ch of letters) {
    if (VALID.indexOf(ch) >= 0) seq += ch;
    else invalid[ch] = true;
  }
  return { seq, invalid: Object.keys(invalid), records };
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
  /** TRUE oligo length — degenerate bases are part of the oligo and are counted. */
  length: number;
  /** (G+C) over the SPECIFICALLY DEFINED bases only; see `ambiguous`. */
  gcPercent: number;
  /** How many bases were IUPAC-ambiguous (or otherwise not A/C/G/T). */
  ambiguous: number;
  /**
   * Set when no Tm could be computed at all — the degenerate pool is larger than
   * `MAX_POOL_MEMBERS`, or a letter is not a base at all. `tm` is then 0 and MUST
   * NOT be displayed — show this instead.
   */
  refusal?: string;
  /**
   * Melting temperature, °C. For a fully defined oligo this is ITS Tm. For a
   * degenerate oligo it is `tmMin` — the exact Tm of the lowest-melting member of
   * the pool, which is the member that decides whether the reaction anneals. It
   * is always a real member's Tm, never an average or an interpolation.
   */
  tm: number;
  /**
   * The pool's exact Tm range, present only when the oligo is degenerate. Both
   * endpoints are the Tm of an actual concrete member, computed by the same
   * nearest-neighbour model — nothing is estimated between them.
   */
  tmMin?: number;
  tmMax?: number;
  /** How many concrete sequences the oligo stands for. Absent when fully defined. */
  poolSize?: number;
  /** Which model produced `tm`. */
  method: "nearest-neighbour" | "wallace";
  /**
   * Enthalpy and entropy of duplex formation (NN only): kcal/mol and cal/mol·K.
   * Omitted for a degenerate pool — a mixture of sequences has no single ΔH.
   */
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

/**
 * The largest degenerate pool `primerTm` will enumerate.
 *
 * THIS IS A COST BOUND, NOT A THERMODYNAMIC ONE. It says nothing about accuracy —
 * every enumerated member is scored exactly. It exists because `primerTm` runs on
 * every keystroke in the DNA pane (`taskpane.ts` binds `updateDnaPreview` to
 * `input`), so the whole enumeration has to fit in a few milliseconds. Measured
 * on this machine, enumerate + score:
 *
 *      256 members    3 ms
 *     4096 members    9 ms
 *    65536 members  128 ms      — visible lag on every keypress
 *  1048576 members  2986 ms     — a frozen pane
 *
 * 4096 covers six fully-degenerate N positions, or twelve two-fold codes
 * (R/Y/S/W/K/M), which is past any primer a person actually orders — a textbook
 * degenerate primer like GGNTGGCANAARGGNTTYCA is 256. Beyond this the oligo is a
 * library rather than a primer, and the function says so instead of guessing.
 *
 * The constant it replaced (`MAX_SKIPPED_NN_STEPS = 4`) claimed to bound ERROR at
 * "~8 °C" and did not: at exactly four skipped steps the quoted Tm measured 12.3 °C
 * below the pool midpoint and 8.8 °C below the coldest member of the pool. Do not
 * reintroduce an error budget expressed as a count of skipped steps.
 */
export const MAX_POOL_MEMBERS = 4096;

/**
 * The second half of the cost bound: total BASES scored, i.e. members × length.
 *
 * `MAX_POOL_MEMBERS` alone is not a bound on work, and an adversarial pass caught
 * exactly that. The DNA pane hands `primerTm` the WHOLE pasted sequence, not a
 * primer — so a 5,000 nt paste carrying six N is a 4,096-member pool of 5,000 nt
 * strings. Measured before this bound existed:
 *
 *      20 nt × 4096 members  =    81,920 bases      8 ms
 *     100 nt × 4096 members  =   409,600 bases    530 ms
 *    1000 nt × 4096 members  = 4,096,000 bases   3572 ms
 *    5000 nt × 4096 members  = 20,480,000 bases 15378 ms   — a frozen Word
 *
 * ~10,500 bases per millisecond, so 150,000 keeps the per-keystroke path inside
 * ~15 ms. Like `MAX_POOL_MEMBERS` this is a COST bound and says nothing about
 * accuracy: everything inside it is scored exactly.
 */
export const MAX_SCORED_BASES = 150_000;

/**
 * Expands an IUPAC string into every concrete ACGT sequence it stands for.
 *
 * Returns the members, or a reason it cannot: a letter that is not a base at all
 * (`unresolvable`), a pool past `MAX_POOL_MEMBERS` (`too-large`), or a pool whose
 * members are individually fine but collectively too much work (`too-costly`).
 * Both bounds are checked BEFORE building, so an absurd input costs a
 * multiplication rather than 20 MB of strings.
 */
type PoolExpansion =
  | { kind: "ok"; members: string[] }
  | { kind: "unresolvable"; letters: string[] }
  | { kind: "too-large"; size: number }
  | { kind: "too-costly"; size: number; length: number };

export function expandIupac(s: string): PoolExpansion {
  const bad: Record<string, true> = {};
  let size = 1;
  for (const ch of s) {
    const exp = IUPAC[ch];
    if (!exp) {
      bad[ch] = true;
      continue;
    }
    size *= exp.length;
    // Stop multiplying once it is hopeless; the caller only needs to know it is
    // past the bound, and 4^5000 is not a number anyone needs exactly.
    if (size > MAX_POOL_MEMBERS * 1024) break;
  }
  const letters = Object.keys(bad);
  if (letters.length) return { kind: "unresolvable", letters };
  if (size > MAX_POOL_MEMBERS) return { kind: "too-large", size };
  if (size > 1 && size * s.length > MAX_SCORED_BASES) {
    return { kind: "too-costly", size, length: s.length };
  }

  let members: string[] = [""];
  for (const ch of s) {
    const exp = IUPAC[ch];
    const next: string[] = [];
    for (const prefix of members) for (const b of exp) next.push(prefix + b);
    members = next;
  }
  return { kind: "ok", members };
}

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
/**
 * Tm of a FULLY DEFINED (ACGT-only) oligo — the one place the physics lives.
 *
 * Everything above this function is bookkeeping about which concrete sequences a
 * user's string stands for; this is the only code that turns a sequence into a
 * temperature, so a degenerate pool and a plain primer cannot drift apart.
 */
function concreteTm(
  s: string,
  sodium: number,
  primer: number
): { tm: number; method: "nearest-neighbour" | "wallace"; deltaH?: number; deltaS?: number; selfComp: boolean } {
  const n = s.length;
  let gc = 0;
  let at = 0;
  for (const ch of s) {
    if (ch === "G" || ch === "C") gc++;
    else at++;
  }
  const selfComp = isSelfComplementary(s);

  // Below ~8 nt the NN model's initiation terms dominate and the duplex is barely
  // stable; the Wallace rule is the honest answer there.
  if (n < 8) return { tm: 2 * at + 4 * gc, method: "wallace", selfComp };

  let dH = 0;
  let dS = 0;
  for (let i = 0; i < n - 1; i++) {
    // `s` is concrete, so every step is tabulated. No step is ever skipped here:
    // skipping was the previous design and it under-reported the Tm by ~2 °C a
    // step while the salt term below kept scaling with the full length.
    const p = NN_PARAMS[s.slice(i, i + 2)];
    if (!p) continue;
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

  const ctTerm = selfComp ? primer : primer / 4;
  const tm = (dH * 1000) / (dS + R_CAL * Math.log(ctTerm)) - 273.15;
  return { tm, method: "nearest-neighbour", deltaH: dH, deltaS: dS, selfComp };
}

export function primerTm(seq: string, opts: PrimerTmOptions = {}): PrimerTm {
  // A DEGENERATE OLIGO IS A MIXTURE, AND NO SINGLE NUMBER DESCRIBES IT.
  //
  // Two earlier designs both tried to make one anyway, and both were wrong:
  //
  //  1. DELETING the ambiguity codes (`.replace(/[^ACGTU]/g, "")`) joined the two
  //     bases flanking an R into a stacking step the oligo does not contain, and
  //     under-reported its length — a 20-mer read "length 18".
  //  2. SKIPPING the steps that contain one dropped real stacking from the sum
  //     while the salt term kept scaling with the full length, so the number came
  //     back systematically low. Measured against the pool the oligo actually is,
  //     skipping was WORSE than the deletion it replaced: −5.8 vs −2.8 °C for one
  //     N, −12.3 vs −5.1 °C for two.
  //
  // So this does neither. Every IUPAC code expands to a known set of bases, so the
  // pool is enumerated and each member scored exactly. What comes back is a RANGE
  // whose endpoints are real members' Tm values. Nothing is interpolated, there is
  // no error budget to calibrate, and a wide range is self-describing: a user who
  // sees "44–65 °C" can see for themselves that this is not one primer.
  const s = seq.toUpperCase().replace(/[^A-Z]/g, "").replace(/U/g, "T");
  const n = s.length;
  let gc = 0;
  let at = 0;
  let ambiguous = 0;
  for (const ch of s) {
    if (ch === "G" || ch === "C") gc++;
    else if (ch === "A" || ch === "T") at++;
    else ambiguous++;
  }
  // GC% is over the DEFINED bases: an R is A or G, so counting it as either a GC
  // or an AT would be a coin flip reported as a measurement.
  const defined = gc + at;
  const gcPercent = defined ? (gc / defined) * 100 : 0;
  const caveats: string[] = [];

  if (n === 0) {
    return { length: 0, gcPercent: 0, ambiguous: 0, tm: 0, method: "wallace", caveats: ["Empty sequence."] };
  }

  const sodium = opts.sodium ?? 0.05;
  const primer = opts.primer ?? 0.25e-6;
  const fallbackMethod: "nearest-neighbour" | "wallace" = n < 8 ? "wallace" : "nearest-neighbour";
  // `caveats` stays EMPTY on a refusal. It used to also carry the refusal text,
  // and the pane renders `refusal` and then `caveats` one after the other — so the
  // same paragraph was printed to the user twice. That was survivable while
  // refusals were rare; this version adds two more of them, so it is not.
  const refuse = (refusal: string): PrimerTm => ({
    length: n,
    gcPercent,
    ambiguous,
    tm: 0,
    method: fallbackMethod,
    refusal,
    caveats: [],
  });

  // Both concentrations appear inside a logarithm, so zero is not "very dilute",
  // it is undefined. At exactly 0 the entropy term goes to −∞ and the formula
  // returns −273.15 °C — absolute zero, finite, and indistinguishable from data,
  // so the finite-check further down cannot catch it. A negative value gives NaN.
  // The pane never passes these today, which is precisely why it would have gone
  // unnoticed if it ever started to.
  if (!(sodium > 0) || !(primer > 0)) {
    return refuse(
      "No Tm could be computed from these conditions — the salt and primer concentrations " +
        "must both be greater than zero (both appear inside a logarithm, so zero has no meaning here)."
    );
  }

  const pool = expandIupac(s);
  if (pool.kind === "unresolvable") {
    // A letter that is not a base at all. It used to be treated as an ambiguity
    // code, so "ACETACGTACGTACGTACGT" quietly returned 49.07 °C for a string that
    // is not a nucleic acid.
    return refuse(
      `“${pool.letters.join(", ")}” ${pool.letters.length === 1 ? "is not a nucleotide" : "are not nucleotides"} — ` +
        "expected A, C, G, T/U or an IUPAC ambiguity code (R, Y, S, W, K, M, B, D, H, V, N). " +
        "No Tm was computed."
    );
  }
  if (pool.kind === "too-large") {
    return refuse(
      `This oligo has ${ambiguous} ambiguous position(s), so it stands for ${pool.size.toLocaleString("en-US")} ` +
        `different sequences — past the ${MAX_POOL_MEMBERS.toLocaleString("en-US")} this tool will score ` +
        "individually. That is a library rather than a primer, and its members' Tm values span " +
        "tens of degrees, so no single number and no range would be useful. Reduce the degeneracy, " +
        "or compute the Tm of the specific members you care about."
    );
  }
  if (pool.kind === "too-costly") {
    return refuse(
      `This is ${pool.length.toLocaleString("en-US")} nt long with ${ambiguous} ambiguous position(s), ` +
        `so scoring every one of its ${pool.size.toLocaleString("en-US")} variants would mean reading ` +
        `${(pool.size * pool.length).toLocaleString("en-US")} bases and would hang the pane. A melting ` +
        "temperature is a measurement about a PRIMER — paste just the primer, or the region you are " +
        "amplifying from, rather than the whole sequence."
    );
  }

  // Score every member exactly. `tm` is reported as the pool MINIMUM: it is a real
  // member's Tm rather than an average, and it is the member that anneals least
  // readily, which is the one that decides the annealing temperature.
  let tmMin = Infinity;
  let tmMax = -Infinity;
  let anySelfComp = false;
  let method: "nearest-neighbour" | "wallace" = fallbackMethod;
  let deltaH: number | undefined;
  let deltaS: number | undefined;
  for (const member of pool.members) {
    const r = concreteTm(member, sodium, primer);
    method = r.method; // every member has the same length, so the same model
    if (r.selfComp) anySelfComp = true;
    if (r.tm < tmMin) {
      tmMin = r.tm;
      deltaH = r.deltaH;
      deltaS = r.deltaS;
    }
    if (r.tm > tmMax) tmMax = r.tm;
  }

  // A non-finite Tm is not a temperature. It cannot happen for a normal oligo (the
  // denominator is a sum of negative entropies), but a caller can pass a zero or
  // negative concentration and get Infinity or NaN out — and NaN reaching the
  // document is its own defect class in this product.
  if (!Number.isFinite(tmMin) || !Number.isFinite(tmMax)) {
    return refuse(
      "No Tm could be computed from these conditions — check that the salt and primer " +
        "concentrations are both above zero."
    );
  }

  const degenerate = pool.members.length > 1;
  if (degenerate) {
    // FIRST, because it says the thing above it is one end of a range rather than
    // a measurement of the oligo as a whole.
    caveats.push(
      `Degenerate oligo: ${ambiguous} ambiguous position(s) stand for ${pool.members.length} sequences, ` +
        `whose Tm spans ${tmMin.toFixed(1)}–${tmMax.toFixed(1)} °C (a ${(tmMax - tmMin).toFixed(1)} °C spread). ` +
        "Both ends are the exact Tm of an actual member — every member was scored, none estimated. " +
        `The ${tmMin.toFixed(1)} °C quoted above is the pool MINIMUM, the member that anneals least ` +
        "readily; design your annealing temperature against it. GC% is over the specifically " +
        "defined bases only."
    );
  }
  if (method === "wallace") {
    caveats.push(
      `Only ${n} nt: too short for the nearest-neighbour model to mean much, so this is the ` +
        "Wallace rule (2·AT + 4·GC) — a rule of thumb, not thermodynamics. Expect several °C of error."
    );
  } else {
    caveats.push(
      `Nearest-neighbour (SantaLucia 1998) at [Na⁺] ${(sodium * 1000).toFixed(0)} mM and ` +
        `${(primer * 1e6).toFixed(2)} µM primer. Tm moves with BOTH — quoting a Tm without them ` +
        "is meaningless, and different suppliers' calculators assume different defaults."
    );
  }
  if (anySelfComp) {
    caveats.push(
      (degenerate ? "At least one member of this pool is" : "This oligo is") +
        " self-complementary (its own reverse complement), so it will form a hairpin/dimer with " +
        "itself. The concentration term is adjusted, but the oligo is a poor primer regardless."
    );
  }
  caveats.push(
    "Assumes a perfectly matched duplex in a two-state transition. It does not model " +
      "mismatches, dangling ends, hairpins or primer-dimers, and it says nothing about " +
      "whether the primer is SPECIFIC to your template — a perfect Tm on a primer that " +
      "binds in three places will still fail."
  );
  if (sodium > 0 && !opts.sodium && method === "nearest-neighbour") {
    caveats.push("Salt defaults to 50 mM Na⁺ (a typical PCR buffer). Mg²⁺ is NOT accounted for; a high-Mg buffer raises the real Tm above this.");
  }

  const result: PrimerTm = { length: n, gcPercent, ambiguous, tm: tmMin, method, caveats };
  if (degenerate) {
    result.tmMin = tmMin;
    result.tmMax = tmMax;
    result.poolSize = pool.members.length;
    // ΔH/ΔS of a mixture is not a quantity; deliberately omitted (see the interface).
  } else {
    result.deltaH = deltaH;
    result.deltaS = deltaS;
  }
  return result;
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
  /** Residues that HAVE a mass and were counted — the basis of mw/pI/GRAVY. */
  length: number;
  /**
   * Residue letters supplied (stop symbols excluded, see `stops`). When this is
   * larger than `length`, some of the input was not used.
   */
  inputLength: number;
  /** Distinct residue letters with no tabulated mass, e.g. X from a degenerate codon. */
  skipped: string[];
  /** How many residues were skipped (not distinct — the count). */
  skippedCount: number;
  /** How many "*" stop symbols were present (a translated ORF can carry them). */
  stops: number;
  /**
   * Stops that are NOT the final symbol — the actionable half of `stops`.
   *
   * A trailing "*" is the ordinary end of a coding sequence and says nothing is
   * wrong. A stop in the MIDDLE says this reading frame is not a single open
   * reading frame at all, which is the one thing a reader needs to be told. A
   * bare total cannot distinguish them, so reporting the total alone would be
   * ambiguous in exactly the direction that misleads.
   */
  internalStops: number;
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

/**
 * Molecular weight, isoelectric point, and GRAVY for a one-letter protein
 * sequence.
 *
 * Residues with no tabulated mass (X above all, which `resolveCodon` emits for
 * every degenerate codon it cannot resolve) cannot be weighed, so they are
 * skipped — but they are REPORTED, unlike before. `MKVLSPADKTNVKAAWXXXX` used to
 * return `{length: 16, mw: 1759.1}`, byte-identical to the 16-residue sequence
 * with the X's deleted: a 20-residue peptide silently described as a 16-residue
 * one. `cleanDna`, `cleanResidues` and `parseSequence` all report what they drop;
 * this is the same contract.
 */
export function proteinProperties(aa: string): ProteinProperties {
  const upper = aa.toUpperCase();
  const seq = upper.replace(/[^A-Z]/g, "");
  const stops = (upper.match(/\*/g) ?? []).length;
  // "Internal" is judged against the residue/stop stream with anything that is
  // neither (whitespace, digits) removed, so a trailing "*\n" still reads as
  // terminal rather than being miscounted as a stop in the middle.
  const symbols = upper.replace(/[^A-Z*]/g, "");
  const internalStops = (symbols.slice(0, -1).match(/\*/g) ?? []).length;
  let mw = WATER_MASS;
  let gravy = 0;
  let gravyN = 0;
  let n = 0;
  let skippedCount = 0;
  const skippedSet: Record<string, true> = {};
  const counts: Record<string, number> = {};
  for (const ch of seq) {
    if (RESIDUE_MASS[ch] === undefined) {
      skippedCount++;
      skippedSet[ch] = true;
      continue;
    }
    mw += RESIDUE_MASS[ch];
    if (HYDROPATHY[ch] !== undefined) {
      gravy += HYDROPATHY[ch];
      gravyN++;
    }
    counts[ch] = (counts[ch] ?? 0) + 1;
    n++;
  }
  const skipped = Object.keys(skippedSet);
  if (n === 0) {
    return { length: 0, inputLength: seq.length, skipped, skippedCount, stops, internalStops, mw: 0, pI: 0, gravy: 0 };
  }
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
    inputLength: seq.length,
    skipped,
    skippedCount,
    stops,
    internalStops,
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
