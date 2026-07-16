// Pairwise sequence alignment — Needleman-Wunsch (global) and Smith-Waterman
// (local), both with AFFINE gap penalties via Gotoh's three-matrix formulation.
//
// Why affine and not linear: a linear penalty charges the same for every gap
// position, so it scatters many short gaps instead of opening one long one. Real
// indels are single events of some length, which is what affine gaps model
// (open + n*extend). Every serious aligner uses affine; a linear-gap alignment
// looks wrong to anyone who reads alignments for a living, and this is the one
// place JurisLab must not be a toy.
//
// Defaults match EMBOSS needle/water so a user can compare results against a tool
// they already trust: BLOSUM62 with gapopen 10 / gapextend 0.5 for protein, and
// EDNAFULL-style +5/-4 with the same gap costs for nucleotide.
//
// Pure numeric/string work — no Office.js — fully unit-testable.

export type AlignMode = "global" | "local";
export type SeqKind = "protein" | "dna";

export interface AlignOptions {
  mode?: AlignMode;
  kind?: SeqKind;
  /** Cost to OPEN a gap (charged once, in addition to the first extend). */
  gapOpen?: number;
  /** Cost per gap position. */
  gapExtend?: number;
  /** Nucleotide scores; ignored for protein (BLOSUM62 is used). */
  match?: number;
  mismatch?: number;
}

export interface AlignResult {
  /** The two sequences with '-' inserted; equal length. */
  a: string;
  b: string;
  /** Match/mismatch/gap ruler: '|' identical, ':' similar (protein only), ' ' otherwise. */
  ruler: string;
  score: number;
  /** Columns where both residues are present and identical. */
  identities: number;
  /** Identical + positively-scoring substitutions (protein). Equals identities for DNA. */
  similarities: number;
  /** Columns containing a gap in either sequence. */
  gaps: number;
  /** Alignment length (columns). */
  length: number;
  /** identities / length, as a percentage. */
  percentIdentity: number;
  percentSimilarity: number;
  percentGaps: number;
  /** 1-based inclusive span of the alignment within each input (local alignments trim). */
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  mode: AlignMode;
  kind: SeqKind;
  caveats: string[];
}

// ---------------------------------------------------------------------------
// BLOSUM62
// ---------------------------------------------------------------------------
// The standard matrix (Henikoff & Henikoff 1992) as distributed with NCBI BLAST
// and EMBOSS. Transcribed here rather than fetched: the aligner must work offline.
//
// A wrong cell would silently skew every protein alignment, so blosum62.test.ts
// checks the properties that pin it — symmetry, the known diagonal (W=11 highest,
// C=9), that conservative pairs score positive and dissimilar pairs negative, and
// the published value range [-4, 11].
const B62_ORDER = "ARNDCQEGHILKMFPSTWYVBZX*";
// prettier-ignore
const B62_ROWS: number[][] = [
  [ 4,-1,-2,-2, 0,-1,-1, 0,-2,-1,-1,-1,-1,-2,-1, 1, 0,-3,-2, 0,-2,-1, 0,-4], // A
  [-1, 5, 0,-2,-3, 1, 0,-2, 0,-3,-2, 2,-1,-3,-2,-1,-1,-3,-2,-3,-1, 0,-1,-4], // R
  [-2, 0, 6, 1,-3, 0, 0, 0, 1,-3,-3, 0,-2,-3,-2, 1, 0,-4,-2,-3, 3, 0,-1,-4], // N
  [-2,-2, 1, 6,-3, 0, 2,-1,-1,-3,-4,-1,-3,-3,-1, 0,-1,-4,-3,-3, 4, 1,-1,-4], // D
  [ 0,-3,-3,-3, 9,-3,-4,-3,-3,-1,-1,-3,-1,-2,-3,-1,-1,-2,-2,-1,-3,-3,-2,-4], // C
  [-1, 1, 0, 0,-3, 5, 2,-2, 0,-3,-2, 1, 0,-3,-1, 0,-1,-2,-1,-2, 0, 3,-1,-4], // Q
  [-1, 0, 0, 2,-4, 2, 5,-2, 0,-3,-3, 1,-2,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4], // E
  [ 0,-2, 0,-1,-3,-2,-2, 6,-2,-4,-4,-2,-3,-3,-2, 0,-2,-2,-3,-3,-1,-2,-1,-4], // G
  [-2, 0, 1,-1,-3, 0, 0,-2, 8,-3,-3,-1,-2,-1,-2,-1,-2,-2, 2,-3, 0, 0,-1,-4], // H
  [-1,-3,-3,-3,-1,-3,-3,-4,-3, 4, 2,-3, 1, 0,-3,-2,-1,-3,-1, 3,-3,-3,-1,-4], // I
  [-1,-2,-3,-4,-1,-2,-3,-4,-3, 2, 4,-2, 2, 0,-3,-2,-1,-2,-1, 1,-4,-3,-1,-4], // L
  [-1, 2, 0,-1,-3, 1, 1,-2,-1,-3,-2, 5,-1,-3,-1, 0,-1,-3,-2,-2, 0, 1,-1,-4], // K
  [-1,-1,-2,-3,-1, 0,-2,-3,-2, 1, 2,-1, 5, 0,-2,-1,-1,-1,-1, 1,-3,-1,-1,-4], // M
  [-2,-3,-3,-3,-2,-3,-3,-3,-1, 0, 0,-3, 0, 6,-4,-2,-2, 1, 3,-1,-3,-3,-1,-4], // F
  [-1,-2,-2,-1,-3,-1,-1,-2,-2,-3,-3,-1,-2,-4, 7,-1,-1,-4,-3,-2,-2,-1,-2,-4], // P
  [ 1,-1, 1, 0,-1, 0, 0, 0,-1,-2,-2, 0,-1,-2,-1, 4, 1,-3,-2,-2, 0, 0, 0,-4], // S
  [ 0,-1, 0,-1,-1,-1,-1,-2,-2,-1,-1,-1,-1,-2,-1, 1, 5,-2,-2, 0,-1,-1, 0,-4], // T
  [-3,-3,-4,-4,-2,-2,-3,-2,-2,-3,-2,-3,-1, 1,-4,-3,-2,11, 2,-3,-4,-3,-2,-4], // W
  [-2,-2,-2,-3,-2,-1,-2,-3, 2,-1,-1,-2,-1, 3,-3,-2,-2, 2, 7,-1,-3,-2,-1,-4], // Y
  [ 0,-3,-3,-3,-1,-2,-2,-3,-3, 3, 1,-2, 1,-1,-2,-2, 0,-3,-1, 4,-3,-2,-1,-4], // V
  [-2,-1, 3, 4,-3, 0, 1,-1, 0,-3,-4, 0,-3,-3,-2, 0,-1,-4,-3,-3, 4, 1,-1,-4], // B
  [-1, 0, 0, 1,-3, 3, 4,-2, 0,-3,-3, 1,-1,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4], // Z
  [ 0,-1,-1,-1,-2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-2, 0, 0,-2,-1,-1,-1,-1,-1,-4], // X
  [-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4, 1], // *
];

const B62_INDEX: Record<string, number> = {};
for (let i = 0; i < B62_ORDER.length; i++) B62_INDEX[B62_ORDER[i]] = i;

/** BLOSUM62 score for a residue pair. Unknown residues score as 'X'. */
export function blosum62(x: string, y: string): number {
  const i = B62_INDEX[x.toUpperCase()] ?? B62_INDEX["X"];
  const j = B62_INDEX[y.toUpperCase()] ?? B62_INDEX["X"];
  return B62_ROWS[i][j];
}

/** The raw matrix, for tests and for callers that want to show it. */
export const BLOSUM62 = { order: B62_ORDER, rows: B62_ROWS };

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

const NEG = -1e9; // stands in for -Infinity without NaN risk in arithmetic

/** Cleans an input sequence: uppercase, strip whitespace/digits (FASTA line numbers). */
export function cleanSequence(s: string): string {
  return s.toUpperCase().replace(/[^A-Z*-]/g, "").replace(/-/g, "");
}

/**
 * Guesses whether a sequence is nucleotide or protein.
 *
 * Deliberately conservative: only calls DNA when the sequence is overwhelmingly
 * ACGTUN. A protein that happens to be Ala/Cys/Gly/Thr-rich must not be aligned
 * with a nucleotide matrix — that would produce a confident, meaningless result.
 */
export function guessKind(s: string): SeqKind {
  const seq = cleanSequence(s);
  if (!seq.length) return "protein";
  let acgtu = 0;
  for (const c of seq) if ("ACGTUN".includes(c)) acgtu++;
  return acgtu / seq.length >= 0.9 ? "dna" : "protein";
}

interface Scorer {
  (x: string, y: string): number;
}

function makeScorer(kind: SeqKind, match: number, mismatch: number): Scorer {
  if (kind === "protein") return blosum62;
  return (x, y) => {
    // Treat U as T so RNA aligns against DNA.
    const a = x === "U" ? "T" : x;
    const b = y === "U" ? "T" : y;
    if (a === "N" || b === "N") return 0; // an ambiguous base is neither reward nor penalty
    return a === b ? match : mismatch;
  };
}

/**
 * Aligns two sequences. Gotoh's algorithm: three DP layers so an affine gap
 * (open + n*extend) is charged correctly rather than per-position.
 *
 *   M  — column ends in a residue/residue pair
 *   Ix — column ends in a gap in B (a residue of A over '-')
 *   Iy — column ends in a gap in A ('-' over a residue of B)
 */
export function align(seqA: string, seqB: string, opts: AlignOptions = {}): AlignResult | null {
  const a = cleanSequence(seqA);
  const b = cleanSequence(seqB);
  if (!a.length || !b.length) return null;

  const mode: AlignMode = opts.mode ?? "global";
  const kind: SeqKind = opts.kind ?? (guessKind(a) === "dna" && guessKind(b) === "dna" ? "dna" : "protein");
  const gapOpen = opts.gapOpen ?? 10;
  const gapExtend = opts.gapExtend ?? 0.5;
  const score = makeScorer(kind, opts.match ?? 5, opts.mismatch ?? -4);

  const n = a.length;
  const m = b.length;
  const local = mode === "local";

  // Layers, (n+1) x (m+1).
  const M: number[][] = [];
  const Ix: number[][] = [];
  const Iy: number[][] = [];
  // Traceback: which layer we came FROM. 0=M 1=Ix 2=Iy, -1 = stop (local zero / origin).
  const tM: number[][] = [];
  const tIx: number[][] = [];
  const tIy: number[][] = [];
  for (let i = 0; i <= n; i++) {
    M.push(new Array(m + 1).fill(NEG));
    Ix.push(new Array(m + 1).fill(NEG));
    Iy.push(new Array(m + 1).fill(NEG));
    tM.push(new Array(m + 1).fill(-1));
    tIx.push(new Array(m + 1).fill(-1));
    tIy.push(new Array(m + 1).fill(-1));
  }

  M[0][0] = 0;
  if (local) {
    // Local: every cell may start fresh at zero, so the borders are 0 and a gap
    // before the alignment costs nothing.
    for (let i = 0; i <= n; i++) M[i][0] = 0;
    for (let j = 0; j <= m; j++) M[0][j] = 0;
  } else {
    // Global: a leading gap is a real gap and is charged.
    for (let i = 1; i <= n; i++) Ix[i][0] = -(gapOpen + i * gapExtend);
    for (let j = 1; j <= m; j++) Iy[0][j] = -(gapOpen + j * gapExtend);
  }

  let best = local ? 0 : NEG;
  let bi = 0;
  let bj = 0;
  let bLayer = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = score(a[i - 1], b[j - 1]);

      // M: extend the best of the three from the diagonal.
      const dM = M[i - 1][j - 1] + s;
      const dIx = Ix[i - 1][j - 1] + s;
      const dIy = Iy[i - 1][j - 1] + s;
      let mv = dM;
      let mt = 0;
      if (dIx > mv) { mv = dIx; mt = 1; }
      if (dIy > mv) { mv = dIy; mt = 2; }
      if (local && mv < 0) { mv = 0; mt = -1; }
      M[i][j] = mv;
      tM[i][j] = mt;

      // Ix: gap in B. Open from M, or extend an existing Ix.
      const oX = M[i - 1][j] - (gapOpen + gapExtend);
      const eX = Ix[i - 1][j] - gapExtend;
      if (oX >= eX) { Ix[i][j] = oX; tIx[i][j] = 0; } else { Ix[i][j] = eX; tIx[i][j] = 1; }

      // Iy: gap in A.
      const oY = M[i][j - 1] - (gapOpen + gapExtend);
      const eY = Iy[i][j - 1] - gapExtend;
      if (oY >= eY) { Iy[i][j] = oY; tIy[i][j] = 0; } else { Iy[i][j] = eY; tIy[i][j] = 2; }

      if (local && M[i][j] > best) { best = M[i][j]; bi = i; bj = j; bLayer = 0; }
    }
  }

  if (!local) {
    // Global: the alignment must reach the far corner, in whichever layer is best.
    best = M[n][m];
    bi = n; bj = m; bLayer = 0;
    if (Ix[n][m] > best) { best = Ix[n][m]; bLayer = 1; }
    if (Iy[n][m] > best) { best = Iy[n][m]; bLayer = 2; }
  }

  // --- traceback ----------------------------------------------------------
  const outA: string[] = [];
  const outB: string[] = [];
  let i = bi;
  let j = bj;
  let layer = bLayer;
  while (i > 0 || j > 0) {
    if (local && layer === 0 && M[i][j] === 0) break; // local alignments stop at zero
    if (layer === 0) {
      if (i === 0 || j === 0) break;
      outA.push(a[i - 1]);
      outB.push(b[j - 1]);
      const from = tM[i][j];
      i--; j--;
      layer = from === -1 ? 0 : from;
      if (from === -1 && local) break;
    } else if (layer === 1) {
      if (i === 0) break;
      outA.push(a[i - 1]);
      outB.push("-");
      const from = tIx[i][j];
      i--;
      layer = from;
    } else {
      if (j === 0) break;
      outA.push("-");
      outB.push(b[j - 1]);
      const from = tIy[i][j];
      j--;
      layer = from;
    }
    // Global alignments must consume any remaining prefix as gaps.
    if (!local && i === 0 && j > 0) { while (j > 0) { outA.push("-"); outB.push(b[j - 1]); j--; } break; }
    if (!local && j === 0 && i > 0) { while (i > 0) { outA.push(a[i - 1]); outB.push("-"); i--; } break; }
  }
  outA.reverse();
  outB.reverse();

  const alnA = outA.join("");
  const alnB = outB.join("");

  // --- statistics ---------------------------------------------------------
  let identities = 0;
  let similarities = 0;
  let gaps = 0;
  const ruler: string[] = [];
  // The identity test must use the SAME equivalence the scorer used, or the stats
  // contradict the alignment. They did: the scorer treated U as T, but this loop
  // compared raw characters, so AUGCGUACGU vs ATGCGTACGT aligned perfectly and then
  // reported 70% identity. The displayed sequences keep the user's own letters.
  const eq = (p: string, q: string): boolean =>
    kind === "dna" ? (p === "U" ? "T" : p) === (q === "U" ? "T" : q) : p === q;
  for (let k = 0; k < alnA.length; k++) {
    const x = alnA[k];
    const y = alnB[k];
    if (x === "-" || y === "-") { gaps++; ruler.push(" "); continue; }
    if (eq(x, y)) { identities++; similarities++; ruler.push("|"); continue; }
    // "Similar" means a positively-scoring substitution — the EMBOSS convention.
    if (kind === "protein" && blosum62(x, y) > 0) { similarities++; ruler.push(":"); continue; }
    ruler.push(kind === "protein" ? " " : ".");
  }
  const length = alnA.length;
  const pct = (x: number) => (length ? Math.round((x / length) * 1000) / 10 : 0);

  // Where the alignment sits in each input (1-based inclusive).
  const aStart = local ? bi - outA.filter((c) => c !== "-").length + 1 : 1;
  const bStart = local ? bj - outB.filter((c) => c !== "-").length + 1 : 1;

  const caveats: string[] = [];
  caveats.push(
    mode === "global"
      ? "Global (Needleman-Wunsch): forces an end-to-end alignment. If the two sequences " +
        "differ greatly in length or share only a domain, use Local — a global alignment " +
        "of unrelated ends is real output that means nothing."
      : "Local (Smith-Waterman): reports the single best-scoring subsegment. Other, " +
        "biologically real matches elsewhere are NOT shown."
  );
  caveats.push(
    kind === "protein"
      ? `BLOSUM62 with gap open ${gapOpen} / extend ${gapExtend} (EMBOSS needle/water defaults). ` +
        "BLOSUM62 is tuned for distant homologues (~62% identity clustering); a different " +
        "matrix will give a different alignment, and neither is 'the' answer."
      : `Match ${opts.match ?? 5} / mismatch ${opts.mismatch ?? -4}, gap open ${gapOpen} / extend ${gapExtend}. ` +
        "N scores 0 against anything, and U is treated as T."
  );
  caveats.push(
    "An optimal alignment is the highest-scoring one UNDER THESE PARAMETERS — not " +
      "necessarily the biologically correct one. Percent identity in particular is very " +
      "sensitive to gap costs."
  );
  if (length && identities / length < 0.25 && kind === "protein") {
    caveats.push(
      `Identity is ${pct(identities)}% — inside the "twilight zone" (below ~25%), where an ` +
        "alignment can look convincing between sequences that are not related at all. " +
        "Do not infer homology from this alone."
    );
  }

  return {
    a: alnA,
    b: alnB,
    ruler: ruler.join(""),
    score: Math.round(best * 10) / 10,
    identities,
    similarities,
    gaps,
    length,
    percentIdentity: pct(identities),
    percentSimilarity: pct(similarities),
    percentGaps: pct(gaps),
    aStart,
    aEnd: aStart + outA.filter((c) => c !== "-").length - 1,
    bStart,
    bEnd: bStart + outB.filter((c) => c !== "-").length - 1,
    mode,
    kind,
    caveats,
  };
}

/**
 * Renders an alignment as the blocked text a biologist expects — the EMBOSS/BLAST
 * layout, with coordinates down both margins.
 */
export function formatAlignment(r: AlignResult, width = 60, nameA = "Seq_A", nameB = "Seq_B"): string {
  const w = Math.max(String(r.aEnd).length, String(r.bEnd).length);
  const label = Math.max(nameA.length, nameB.length);
  const out: string[] = [];
  let posA = r.aStart;
  let posB = r.bStart;

  for (let k = 0; k < r.length; k += width) {
    const chunkA = r.a.slice(k, k + width);
    const chunkB = r.b.slice(k, k + width);
    const chunkR = r.ruler.slice(k, k + width);
    const usedA = chunkA.replace(/-/g, "").length;
    const usedB = chunkB.replace(/-/g, "").length;
    const endA = posA + usedA - 1;
    const endB = posB + usedB - 1;

    out.push(
      `${nameA.padEnd(label)} ${String(posA).padStart(w)} ${chunkA} ${String(Math.max(endA, posA - 1)).padStart(w)}`
    );
    out.push(`${" ".repeat(label)} ${" ".repeat(w)} ${chunkR}`);
    out.push(
      `${nameB.padEnd(label)} ${String(posB).padStart(w)} ${chunkB} ${String(Math.max(endB, posB - 1)).padStart(w)}`
    );
    out.push("");
    posA = endA + 1;
    posB = endB + 1;
  }
  // .trimEnd() would be clearer, but the TS target here predates ES2019.
  return out.join("\n").replace(/\s+$/, "");
}
