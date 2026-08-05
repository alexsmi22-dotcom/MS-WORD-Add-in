// Builds a 2D structure (via SMILES) from a peptide sequence — one-letter or
// three-letter amino-acid codes. For the biologics / peptide-therapeutics
// audience: type a sequence, get the drawn structure and its formula/mass.
//
// The generated SMILES encodes the correct *constitution* (backbone + side
// chains + free N-/C-termini) but NOT stereochemistry: emitting a specific
// chirality that might be wrong would violate the "all data must be real"
// rule, so the alpha carbons are left unspecified and the depiction is labeled
// as constitutional. Pure functions; no Office.js.

interface AminoAcid {
  one: string;
  three: string;
  name: string;
  /** SMILES for the side chain attached to the alpha carbon (empty = glycine). */
  side: string;
  /** Proline's ring folds the backbone nitrogen in, so its unit is special. */
  special?: string;
  /**
   * Genetically encoded but not one of the 20 — Sec (U) and Pyl (O). Flagged so
   * the UI can label them, not to exclude them: they are real residues, they are
   * in `sequence.ts`'s ST.26 alphabet and in `dna.ts`'s mass table, and this
   * module used to be the only place that rejected them — which truncated a
   * selenoprotein peptide silently at the first U.
   */
  nonstandard?: boolean;
}

// Side chains are written as the branch hanging off the alpha carbon Cα.
const AMINO_ACIDS: AminoAcid[] = [
  { one: "G", three: "Gly", name: "Glycine", side: "" },
  { one: "A", three: "Ala", name: "Alanine", side: "C" },
  { one: "V", three: "Val", name: "Valine", side: "C(C)C" },
  { one: "L", three: "Leu", name: "Leucine", side: "CC(C)C" },
  { one: "I", three: "Ile", name: "Isoleucine", side: "C(C)CC" },
  { one: "P", three: "Pro", name: "Proline", side: "", special: "N1CCCC1C(=O)" },
  { one: "F", three: "Phe", name: "Phenylalanine", side: "Cc1ccccc1" },
  { one: "W", three: "Trp", name: "Tryptophan", side: "Cc1c[nH]c2ccccc12" },
  { one: "M", three: "Met", name: "Methionine", side: "CCSC" },
  { one: "S", three: "Ser", name: "Serine", side: "CO" },
  { one: "T", three: "Thr", name: "Threonine", side: "C(C)O" },
  { one: "C", three: "Cys", name: "Cysteine", side: "CS" },
  { one: "Y", three: "Tyr", name: "Tyrosine", side: "Cc1ccc(O)cc1" },
  { one: "N", three: "Asn", name: "Asparagine", side: "CC(N)=O" },
  { one: "Q", three: "Gln", name: "Glutamine", side: "CCC(N)=O" },
  { one: "D", three: "Asp", name: "Aspartate", side: "CC(=O)O" },
  { one: "E", three: "Glu", name: "Glutamate", side: "CCC(=O)O" },
  { one: "K", three: "Lys", name: "Lysine", side: "CCCCN" },
  { one: "R", three: "Arg", name: "Arginine", side: "CCCNC(=N)N" },
  { one: "H", three: "His", name: "Histidine", side: "Cc1c[nH]cn1" },
  // The 21st and 22nd proteinogenic residues. Sec is cysteine with selenium in
  // place of sulfur (C3H7NO2Se, 168.05). Pyl is lysine whose ε-amine is acylated
  // by (4R,5R)-4-methylpyrroline-5-carboxylate (C12H21N3O3, 255.32); as
  // everywhere in this module the ring stereocentres are left unspecified rather
  // than asserted.
  { one: "U", three: "Sec", name: "Selenocysteine", side: "C[SeH]", nonstandard: true },
  { one: "O", three: "Pyl", name: "Pyrrolysine", side: "CCCCNC(=O)C1C(C)CC=N1", nonstandard: true },
];

const BY_ONE: Record<string, AminoAcid> = {};
const BY_THREE: Record<string, AminoAcid> = {};
for (const aa of AMINO_ACIDS) {
  BY_ONE[aa.one] = aa;
  BY_THREE[aa.three.toUpperCase()] = aa;
}

export interface ParsedSequence {
  /** Recognized residues, in order (one-letter codes). */
  codes: string[];
  /** Tokens that were not a valid amino acid. */
  invalid: string[];
}

/**
 * Parses a peptide sequence. Accepts a bare one-letter string ("ACDEFG"),
 * or three-letter codes separated by spaces/hyphens ("Ala-Gly-Ser").
 */
export function parseSequence(input: string): ParsedSequence {
  const trimmed = input.trim();
  const codes: string[] = [];
  const invalid: string[] = [];
  if (!trimmed) return { codes, invalid };

  const tokens = trimmed.split(/[\s\-,]+/).filter(Boolean);
  const pushOne = (ch: string): void => {
    const aa = BY_ONE[ch.toUpperCase()];
    if (aa) codes.push(aa.one);
    else invalid.push(ch);
  };
  const pushThree = (t: string): void => {
    const aa = BY_THREE[t.toUpperCase()];
    if (aa) codes.push(aa.one);
    else invalid.push(t);
  };

  if (tokens.length === 1) {
    const t = tokens[0];
    // A lone token that is exactly a known three-letter code = that one residue;
    // otherwise it's a bare one-letter sequence ("ACDEFG"), read per character.
    // THREE-LETTER WINS, deliberately and consistently: "ALA" and "CYS" have
    // always read as one residue rather than A-L-A and C-Y-S, and adding Sec and
    // Pyl extends that to "SEC" and "PYL". Anyone meaning the tripeptide can
    // space or hyphenate it ("S E C"), which is unambiguous either way.
    if (t.length === 3 && BY_THREE[t.toUpperCase()]) pushThree(t);
    else for (const ch of t) pushOne(ch);
    return { codes, invalid };
  }

  // Multiple tokens: three-letter mode only if some token is a recognized
  // three-letter code ("Ala Gly Ser"); otherwise it's a spaced or hyphenated
  // one-letter sequence ("A C G", "AC-DE"), so expand each token per character.
  const anyThree = tokens.some((t) => t.length === 3 && BY_THREE[t.toUpperCase()]);
  if (anyThree) tokens.forEach(pushThree);
  else for (const t of tokens) for (const ch of t) pushOne(ch);
  return { codes, invalid };
}

/**
 * Builds a peptide SMILES from one-letter residue codes (free amine at the
 * N-terminus, free acid at the C-terminus). Returns null for an empty or
 * fully-unrecognized sequence. Stereochemistry is intentionally unspecified.
 */
export function peptideSmiles(codes: string[]): string | null {
  if (!codes.length) return null;
  const units: string[] = [];
  for (const c of codes) {
    const aa = BY_ONE[c];
    if (!aa) return null;
    if (aa.special) {
      units.push(aa.special);
    } else if (aa.side === "") {
      units.push("NCC(=O)"); // glycine: unsubstituted alpha carbon
    } else {
      units.push(`NC(${aa.side})C(=O)`);
    }
  }
  // Close the terminal carbonyl into a carboxylic acid.
  return units.join("") + "O";
}

export interface PeptideResult {
  /** One-letter sequence actually built. */
  sequence: string;
  smiles: string;
  length: number;
  invalid: string[];
}

/** Parses `input` and builds the peptide SMILES, or null if nothing valid. */
export function buildPeptide(input: string): PeptideResult | null {
  const { codes, invalid } = parseSequence(input);
  const smiles = peptideSmiles(codes);
  if (!smiles) return null;
  return { sequence: codes.join(""), smiles, length: codes.length, invalid };
}

/**
 * The proteinogenic amino acids, for a reference/legend in the UI — the 20
 * standard ones plus Sec and Pyl, flagged.
 */
export function aminoAcidTable(): { one: string; three: string; name: string; nonstandard: boolean }[] {
  return AMINO_ACIDS.map((a) => ({ one: a.one, three: a.three, name: a.name, nonstandard: !!a.nonstandard }));
}
