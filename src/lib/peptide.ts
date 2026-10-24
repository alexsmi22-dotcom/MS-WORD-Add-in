// Builds a 2D structure (via SMILES) from a peptide sequence — one-letter or
// three-letter amino-acid codes. For the biologics / peptide-therapeutics
// audience: type a sequence, get the drawn structure and its formula/mass.
//
// The generated SMILES encodes the correct *constitution* (backbone + side
// chains + free N-/C-termini) but NOT stereochemistry: emitting a specific
// chirality that might be wrong would violate the "all data must be real"
// rule, so the alpha carbons are left unspecified and the depiction is labeled
// as constitutional. Pure functions; no Office.js.

import { Molecule } from "openchemlib";
import {
  Composition,
  ModDef,
  ModKey,
  MODS,
  RESIDUE_COMPOSITION,
  WATER,
  CYCLISATION,
  DISULFIDE,
  SUPPORTED_BRACKET_NAMES,
  addComposition,
  averageMass,
  hillFormula,
  lookupMod,
  monoMass,
  pairingCount,
  typesetFormula,
} from "./peptideMods";

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
  /** The full notation reading (v2.137.0), absent on the legacy unknown-letter path. */
  reading?: PeptideReading;
}

/**
 * Parses `input` and builds the peptide SMILES, or null if nothing valid.
 *
 * v2.137.0: the notation reader (`readPeptide`) runs first, so `cyclo(…)`,
 * `Ac-…-NH2`, `pS`, `M[Oxidation]` and the rest are no longer read as residue
 * letters. When the reader REFUSES, this returns null — never the old
 * letter-by-letter guess — with ONE exception kept for the pinned behaviour:
 * a plain, single-case letter string whose only problem is an unknown letter
 * (B, J, X, Z) still builds with that letter dropped and listed in `invalid`.
 * The pane should call `readPeptide` to show the refusal message.
 */
export function buildPeptide(input: string): PeptideResult | null {
  const reading = readPeptide(input);
  if (reading.ok) {
    if (!reading.smiles) return null;
    return { sequence: reading.sequence, smiles: reading.smiles, length: reading.length, invalid: [], reading };
  }
  if (reading.kind !== "unknown-letter" || !isPlainSingleCase(input)) return null;
  // Drop the unknown letters, then let the NOTATION reader read the rest — so
  // termini in a plain string (GXG-OH, H-GXG-OH) are still read as termini and
  // never fall back to the letter-by-letter Pyl-His guess.
  const { invalid } = parseSequence(input);
  const stripped = input.replace(/[A-Za-z]/g, (ch) => (BY_ONE[ch.toUpperCase()] ? ch : ""));
  const rest = readPeptide(stripped);
  if (!rest.ok || !rest.smiles) return null;
  return { sequence: rest.sequence, smiles: rest.smiles, length: rest.length, invalid, reading: rest };
}

function isPlainSingleCase(input: string): boolean {
  if (!/^[A-Za-z\s,-]*$/.test(input)) return false;
  return !(/[a-z]/.test(input) && /[A-Z]/.test(input));
}

// ===========================================================================
// Notation reader — modified, cyclic and disulfide-bridged peptides
// (v2.137.0, SCOPE-CHEMBIO-BATCH §B5/§D4). Masses come from composition
// (peptideMods.ts); the SMILES is generated independently and its OCL formula
// must equal the composition formula, or the reading is refused.
//
// RULE: a token the reader does not understand is refused by name with its
// 1-based character position in the ORIGINAL input. It is never mapped to a
// residue letter.
// ===========================================================================

export type PeptideRefusalKind =
  | "empty"
  | "too-long"
  | "unknown-letter"
  | "mixed-case"
  | "digit"
  | "character"
  | "bracket"
  | "unknown-mod"
  | "mod-site"
  | "cyclo"
  | "termini"
  | "three-letter"
  | "nonstandard"
  | "stereo"
  | "ambiguous"
  | "disulfide"
  | "cross-check";

export interface PeptideRefusal {
  ok: false;
  kind: PeptideRefusalKind;
  message: string;
  /** 1-based character position in the input, or null when not positional. */
  position: number | null;
  token: string;
}

export interface ReadResidue {
  code: string;
  three: string;
  mod: ModKey | null;
}

export interface AppliedModification {
  name: string;
  /** "UNIMOD:21", or null for head-to-tail cyclisation (no accession). */
  accession: string | null;
  /** Where: residue labels such as "S3", or "N-term" / "C-term" / "C1–C6". */
  sites: string[];
  count: number;
  /** Per-occurrence deltas. */
  deltaMono: number;
  deltaAvg: number;
  /** Typeset composition delta, e.g. "+HPO₃", "−H₂". */
  deltaComposition: string;
}

export interface PeptideReading {
  ok: true;
  /** Plain one-letter codes of the residues (modified ones as their parent letter). */
  sequence: string;
  residues: ReadResidue[];
  length: number;
  /** Canonical one-letter/ProForma display; re-parses to the same reading. */
  display: string;
  /** Three-letter display; also re-parses to the same reading. */
  threeLetter: string;
  nTerminus: "free amine" | "acetyl" | "pyroglutamate" | "none (head-to-tail cyclic)";
  cTerminus: "free acid" | "amide" | "none (head-to-tail cyclic)";
  cyclic: boolean;
  /** 1-based residue-number pairs; empty when "all paired" with ≥ 4 Cys. */
  disulfides: [number, number][];
  disulfideCount: number;
  /** False when "all paired" was asked with ≥ 4 Cys: mass known, pairing not. */
  disulfidePairingKnown: boolean;
  /** Exact cystine count, for assay.ts extinctionCoefficient. */
  cystinePairs: number;
  composition: Composition;
  /** Hill formula, ASCII (C22H35N9O9) and typeset (C₂₂H₃₅N₉O₉). */
  formula: string;
  formulaTypeset: string;
  monoisotopic: number;
  average: number;
  modifications: AppliedModification[];
  /** Null when the structure cannot be drawn (see structureRefusal). */
  smiles: string | null;
  structureRefusal: string | null;
  stereo: string;
  notes: string[];
}

export const PEPTIDE_STEREO_NOTE = "Stereochemistry unspecified — constitution only.";
export const MAX_PEPTIDE_INPUT = 5000;
// The residue cap bounds parsing only. TIME is bounded by
// MAX_CHECKED_HEAVY_ATOMS: the OCL cross-check scales with atoms, not residues
// (measured warm, unloaded: cyclo(W×150) 2100 heavy atoms 0.14 s, cyclo(W×300)
// 4200 atoms 0.34 s, cyclo(W×998) ~14000 atoms 12–14 s). Above the atom limit
// no structure is built or checked; the composition masses still stand.
export const MAX_PEPTIDE_RESIDUES = 1000;
export const MAX_CHECKED_HEAVY_ATOMS = 3000;

/**
 * Non-standard residues with three-letter codes. A token equal to one of these
 * (any case) is refused by name — never split into one-letter codes
 * ("hyp" ≠ His-Tyr-Pro). Same precedence as the standard three-letter rule.
 */
const NONSTANDARD_THREE: Record<string, string> = {
  HYP: "hydroxyproline",
  ORN: "ornithine",
  NLE: "norleucine",
  NVA: "norvaline",
  ABU: "2-aminobutyric acid",
  AIB: "2-aminoisobutyric acid",
  SAR: "sarcosine (N-methylglycine)",
  DAB: "2,4-diaminobutyric acid",
  DAP: "2,3-diaminopropionic acid",
  CIT: "citrulline",
  HCY: "homocysteine",
  HSE: "homoserine",
  PHG: "phenylglycine",
  CHA: "cyclohexylalanine",
  NAL: "naphthylalanine",
  TLE: "tert-leucine",
  AAD: "2-aminoadipic acid",
  HYL: "hydroxylysine",
  ASX: "Asx (Asn or Asp — ambiguous)",
  GLX: "Glx (Gln or Glu — ambiguous)",
  XAA: "Xaa (unknown residue)",
  XLE: "Xle (Leu or Ile — ambiguous)",
};
const MAX_DISULFIDES = 200;

const DISULFIDE_MONO = 2 * -1.007825; // 2 × Dehydro (UNIMOD:374)
const DISULFIDE_AVG = -2.0159; // 2 × 1.00794 (Unimod's average H), rounded to 4 d.p.

class Refused extends Error {
  constructor(public r: PeptideRefusal) {
    super(r.message);
  }
}
function refuse(kind: PeptideRefusalKind, message: string, position: number | null, token: string): never {
  throw new Refused({ ok: false, kind, message, position, token });
}

const PYRO_THREE = new Set(["PGLU", "PYR", "GLP"]);

/** Side-chain SMILES for a modified residue (the branch on Cα). */
const MOD_SIDE: Record<string, string> = {
  "S:Phospho": "COP(=O)(O)O",
  "T:Phospho": "C(C)OP(=O)(O)O",
  "Y:Phospho": "Cc1ccc(OP(=O)(O)O)cc1",
  "M:Oxidation": "CCS(=O)C",
  "K:Acetyl": "CCCCNC(C)=O",
  // Deamidation drawn as Asp/Glu. The isoAsp product has the same mass but a
  // different constitution — said in the notes.
  "N:Deamidated": "CC(=O)O",
  "Q:Deamidated": "CCC(=O)O",
};

interface Tok {
  text: string;
  /** 0-based index into the normalised input (same indexing as the original). */
  start: number;
}

/** 1:1 character normalisation, so positions survive: NH₂ → NH2, dashes → "-". */
function normalise(s: string): string {
  return s.replace(/₂/g, "2").replace(/[‐‑‒–—−]/g, "-");
}

/** Splits on whitespace/comma/hyphen outside [ ] and ( ). Refuses stray brackets. */
function splitTokens(s: string, base: number): Tok[] {
  const tokens: Tok[] = [];
  const stack: { ch: string; at: number }[] = [];
  let cur = "";
  let curStart = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[" || ch === "(") stack.push({ ch, at: base + i });
    else if (ch === "]" || ch === ")") {
      const open = stack.pop();
      const want = ch === "]" ? "[" : "(";
      if (!open || open.ch !== want) {
        refuse("bracket", `Stray “${ch}” at position ${base + i + 1} — it closes nothing.`, base + i + 1, ch);
      }
    }
    if (stack.length === 0 && /[\s,-]/.test(ch)) {
      if (cur) tokens.push({ text: cur, start: curStart });
      cur = "";
      curStart = -1;
      continue;
    }
    if (!cur) curStart = base + i;
    cur += ch;
  }
  if (stack.length) {
    const open = stack[stack.length - 1];
    refuse("bracket", `Unclosed “${open.ch}” at position ${open.at + 1}.`, open.at + 1, open.ch);
  }
  if (cur) tokens.push({ text: cur, start: curStart });
  return tokens;
}

/** Index of the bracket matching s[open], or −1. */
function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface Parsed {
  residues: ReadResidue[];
  /** 1-based input position of each residue, for messages. */
  positions: number[];
  nTerm: "free" | "acetyl";
  cTerm: "free" | "amide";
  cyclic: boolean;
  notes: string[];
  disulfides: [number, number][];
  disulfideAll: number; // bonds from "all paired" when the pairing is not drawn
}

function applyMod(
  out: Parsed,
  code: string,
  mod: ModDef,
  pos: number,
  token: string,
  cyclic: boolean
): ModKey {
  const idx = out.residues.length; // index this residue will take
  if (mod.key === "Amidated") {
    refuse("mod-site", `${token} at position ${pos}: amidation is C-terminal — write -NH2 or -[Amidated] after the last residue.`, pos, token);
  }
  if (mod.key === "Gln->pyro-Glu" || mod.key === "Glu->pyro-Glu") {
    const parent = mod.key === "Gln->pyro-Glu" ? "Q" : "E";
    if (code !== parent) {
      refuse("mod-site", `${token} at position ${pos}: ${mod.key} applies to ${parent} only.`, pos, token);
    }
    if (cyclic) {
      refuse("cyclo", `${token} at position ${pos}: pyroglutamate needs a free N-terminus, and a head-to-tail cyclic peptide has none.`, pos, token);
    }
    if (idx !== 0) {
      refuse("mod-site", `${token} at position ${pos}: pyroglutamate forms only at the N-terminus (residue 1).`, pos, token);
    }
    return mod.key;
  }
  if (!mod.residues.includes(code)) {
    const where =
      mod.key === "Acetyl"
        ? "K only (N-terminal acetylation is written Ac- or [Acetyl]-)"
        : mod.residues.join(", ") + " only";
    refuse("mod-site", `${mod.key} on ${code} at position ${pos} is not supported — ${mod.key} is read on ${where}.`, pos, token);
  }
  return mod.key;
}

function pushResidue(out: Parsed, code: string, mod: ModKey | null, pos: number): void {
  if (out.residues.length >= MAX_PEPTIDE_RESIDUES) {
    refuse("too-long", `More than ${MAX_PEPTIDE_RESIDUES} residues — this reader stops there.`, pos, code);
  }
  out.residues.push({ code, three: BY_ONE[code].three, mod });
  out.positions.push(pos);
}

function parseThreeLetter(out: Parsed, toks: Tok[], cyclic: boolean): void {
  for (const t of toks) {
    const pos = t.start + 1;
    const m = /^([A-Za-z]{3,4})(\[[^\]]*\]|\([^)]*\))?$/.exec(t.text);
    if (!m) {
      if (/^[DL]$/i.test(t.text) || /^[DL]-?$/i.test(t.text)) {
        refuse("stereo", `“${t.text}-” at position ${pos}: D-/L- configuration prefixes are not read — this tool draws constitution only (stereochemistry unspecified), and D-amino acids are not supported.`, pos, t.text);
      }
      if (/\d/.test(t.text)) {
        const k = t.text.search(/\d/);
        refuse("digit", `Digit “${t.text[k]}” at position ${t.start + k + 1} in “${t.text}” is not part of a three-letter code. Residue numbers belong in a disulfide clause (; disulfide 1-6).`, t.start + k + 1, t.text);
      }
      refuse("three-letter", `“${t.text}” at position ${pos} is not a three-letter amino-acid code (one-letter codes cannot be mixed into a three-letter sequence).`, pos, t.text);
    }
    const name = m[1];
    const up = name.toUpperCase();
    if (PYRO_THREE.has(up)) {
      if (m[2]) refuse("mod-site", `“${t.text}” at position ${pos}: pyroglutamate takes no further modification.`, pos, t.text);
      const key = applyMod(out, "Q", MODS["Gln->pyro-Glu"], pos, t.text, cyclic);
      pushResidue(out, "Q", key, pos);
      continue;
    }
    if (name.length !== 3 || !BY_THREE[up]) {
      refuse("three-letter", `“${t.text}” at position ${pos} is not a three-letter amino-acid code.`, pos, t.text);
    }
    const code = BY_THREE[up].one;
    let mod: ModKey | null = null;
    if (m[2]) mod = readModSuffix(out, code, m[2], t.start + name.length, cyclic);
    pushResidue(out, code, mod, pos);
  }
}

/** Reads "[Name]" or the "(ox)"/"(ph)" alias after a residue. at = 0-based index of the bracket. */
function readModSuffix(out: Parsed, code: string, suffix: string, at: number, cyclic: boolean): ModKey {
  const pos = at + 1;
  const inner = suffix.slice(1, -1);
  if (suffix[0] === "(") {
    const alias = inner.trim().toLowerCase();
    if (alias === "ox" && code === "M") {
      out.notes.push("M(ox) read as methionine sulfoxide — the same as M[Oxidation].");
      return applyMod(out, code, MODS.Oxidation, pos, suffix, cyclic);
    }
    if ((alias === "ph" || alias === "p") && ["S", "T", "Y"].includes(code)) {
      out.notes.push(`${code}(${inner}) read as phospho-${BY_ONE[code].three} — the same as ${code}[Phospho].`);
      return applyMod(out, code, MODS.Phospho, pos, suffix, cyclic);
    }
    refuse(
      "unknown-mod",
      `Parenthesised modifier “${suffix}” on ${code} at position ${pos} is not read. Supported shorthands: M(ox), S(ph)/T(ph)/Y(ph); otherwise write a bracket name: ${SUPPORTED_BRACKET_NAMES.join("; ")}.`,
      pos,
      suffix
    );
  }
  const mod = lookupMod(inner);
  const delta = /^\s*([+\-−])\s*(\d+(?:\.\d+)?)\s*$/.exec(inner);
  if (!mod && delta) {
    // A ProForma MASS DELTA (T[+79.966]) names a mass, not a composition: the formula, the average mass and the
    // structure this pane gives would all be invented. Refused by name, with the named modification it matches.
    const d = (delta[1] === "+" ? 1 : -1) * Number(delta[2]);
    const near = (Object.values(MODS) as ModDef[]).find((m) => m.key !== "Dehydro" && Math.abs(m.unimodMono - d) < 0.01);
    refuse(
      "unknown-mod",
      `Mass delta “${suffix}” at position ${pos} is not read: a mass alone gives no formula, average mass or structure.` +
        (near ? ` It matches ${near.key} (${near.unimodMono.toFixed(4)} Da) — write ${code}[${near.key}].` : ` Write a named modification: ${SUPPORTED_BRACKET_NAMES.join("; ")}.`),
      pos,
      suffix
    );
  }
  if (!mod) {
    refuse("unknown-mod", `Unknown modification “${suffix}” at position ${pos}. Supported: ${SUPPORTED_BRACKET_NAMES.join("; ")}.`, pos, suffix);
  }
  return applyMod(out, code, mod, pos, suffix, cyclic);
}

function parseOneLetter(out: Parsed, toks: Tok[], cyclic: boolean): void {
  // Case rule: a sequence with ANY uppercase residue letter is read
  // case-sensitively — lowercase is then only the declared p prefix (pS, pT,
  // pY, N-terminal pE). An all-lowercase sequence is upper-cased as before
  // (so "akpspr" is still A-K-P-S-P-R: p is proline there).
  let anyUpper = false;
  for (const t of toks) {
    let depth = 0;
    for (const ch of t.text) {
      if (ch === "[" || ch === "(") depth++;
      else if (ch === "]" || ch === ")") depth--;
      else if (depth === 0 && /[A-Z]/.test(ch)) anyUpper = true;
    }
  }
  for (const t of toks) {
    const s = t.text;
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      const pos = t.start + i + 1;
      if (/[A-Za-z]/.test(ch)) {
        let code = ch;
        let prefixMod: ModDef | null = null;
        let prefixTok = "";
        if (/[a-z]/.test(ch)) {
          if (!anyUpper) code = ch.toUpperCase();
          else if (ch === "p" && /[STYE]/.test(s[i + 1] || "")) {
            const next = s[i + 1];
            prefixTok = "p" + next;
            prefixMod = next === "E" ? MODS["Glu->pyro-Glu"] : MODS.Phospho;
            code = next;
            i++;
          } else {
            refuse(
              "mixed-case",
              `Lowercase “${ch}” at position ${pos} inside an uppercase sequence is not read as a residue. ` +
                `Lowercase often marks a D-amino acid, which is not supported (stereochemistry unspecified); ` +
                `phosphorylation is pS/pT/pY or S[Phospho]; pyroglutamate is N-terminal pE or pGlu-.`,
              pos,
              ch
            );
          }
        }
        if (!BY_ONE[code]) {
          refuse(
            "unknown-letter",
            `“${code}” at position ${pos} is not an amino-acid code (B, J, X and Z are ambiguity or unknown codes and have no structure).`,
            pos,
            code
          );
        }
        i++;
        let mod: ModKey | null = null;
        if (prefixMod) {
          if (prefixMod.key === "Phospho") out.notes.push(`${prefixTok} read as phospho-${BY_ONE[code].three} — the same as ${code}[Phospho].`);
          else out.notes.push("pE read as N-terminal pyroglutamate (from Glu) — the same as E[Glu->pyro-Glu].");
          mod = applyMod(out, code, prefixMod, pos, prefixTok, cyclic);
        }
        if (s[i] === "[" || s[i] === "(") {
          if (mod) {
            refuse("mod-site", `${prefixTok} at position ${pos} already carries a modification; a second one is not read.`, pos, prefixTok);
          }
          const close = matchBracket(s, i);
          const suffix = s.slice(i, close + 1);
          mod = readModSuffix(out, code, suffix, t.start + i, cyclic);
          i = close + 1;
          if (s[i] === "[" || s[i] === "(") {
            refuse("mod-site", `A second modification on ${code} at position ${t.start + i + 1} is not read — one modification per residue.`, t.start + i + 1, s[i]);
          }
        }
        pushResidue(out, code, mod, pos);
        continue;
      }
      if (/\d/.test(ch)) {
        refuse("digit", `Digit “${ch}” at position ${pos} is not a residue. Residue numbers belong in a disulfide clause (; disulfide 1-6); -NH2 needs its hyphen.`, pos, ch);
      }
      if (ch === "[" || ch === "(") {
        const close = matchBracket(s, i);
        refuse("bracket", `“${s.slice(i, close + 1)}” at position ${pos} does not follow a residue letter — a modification is written after its residue, e.g. S[Phospho].`, pos, s.slice(i, close + 1));
      }
      refuse("character", `“${ch}” at position ${pos} is not part of peptide notation.`, pos, ch);
    }
  }
}

function parseDisulfideClause(text: string, base: number, out: Parsed): void {
  const lead = text.length - text.trimStart().length;
  const t = text.trim();
  const at = base + lead + 1;
  const m = /^(?:disulfides?|disulphides?|ss|s-s)\b\s*:?\s*(.*)$/i.exec(t);
  let rest: string;
  let restAt: number;
  if (m) {
    rest = m[1];
    restAt = base + lead + (t.length - m[1].length);
  } else if (/^all\s+cysteines\s+paired$/i.test(t)) {
    rest = "all";
    restAt = base + lead;
  } else {
    refuse("disulfide", `“${t}” at position ${at} is not a recognised clause. After “;” write a disulfide clause: “disulfide 1-6”, “ss 1-6, 3-11”, “disulfide C2-C7” or “disulfide all”.`, at, t);
  }
  if (out.disulfides.length || out.disulfideAll) {
    refuse("disulfide", `A second disulfide clause at position ${at} — give every bond in one clause.`, at, t);
  }
  const cysIdx = out.residues.map((r, i) => (r.code === "C" ? i + 1 : 0)).filter(Boolean);
  if (/^all(\s+cysteines(\s+paired)?)?$/i.test(rest.trim())) {
    const n = cysIdx.length;
    if (n === 0) refuse("disulfide", "“disulfide all” but the sequence has no cysteines.", at, t);
    if (n === 1) {
      refuse("disulfide", `Only one cysteine (Cys${cysIdx[0]}) — a single cysteine cannot form a disulfide.`, at, t);
    }
    if (n % 2 !== 0) {
      refuse("disulfide", `${n} cysteine${n === 1 ? "" : "s"} — one is unpaired, so “all paired” is impossible. Give the pairing (e.g. disulfide ${cysIdx[0]}-${cysIdx[1] ?? cysIdx[0]}).`, at, t);
    }
    if (n === 2) out.disulfides.push([cysIdx[0], cysIdx[1]]);
    else out.disulfideAll = n / 2;
    return;
  }
  const parts = rest.split(/\s*(?:,|\band\b)\s*/i);
  let offset = restAt;
  const used = new Map<number, number>();
  for (const raw of parts) {
    const p = raw.trim();
    const pAt = rest.indexOf(raw, offset - restAt) + restAt;
    offset = pAt + raw.length;
    const pm = /^(?:(c|cys)\s*)?(\d{1,6})\s*-\s*(?:(c|cys)\s*)?(\d{1,6})$/i.exec(p);
    if (!pm) {
      refuse("disulfide", `“${p}” at position ${pAt + 1} is not a disulfide pair — write residue numbers like 1-6 or C2-C7.`, pAt + 1, p);
    }
    const a = parseInt(pm[2], 10);
    const b = parseInt(pm[4], 10);
    for (const k of [a, b]) {
      if (k < 1 || k > out.residues.length) {
        refuse("disulfide", `Residue ${k} in “${p}” (position ${pAt + 1}) is outside the ${out.residues.length}-residue sequence.`, pAt + 1, p);
      }
      const r = out.residues[k - 1];
      if (r.code === "U") {
        refuse("disulfide", `Residue ${k} is selenocysteine (Sec) — selenylsulfide/diselenide bridges are not supported; only Cys–Cys disulfides.`, pAt + 1, p);
      }
      if (r.code !== "C") {
        refuse("disulfide", `Residue ${k} is ${r.three}, not Cys — a disulfide joins two cysteines (“${p}”, position ${pAt + 1}).`, pAt + 1, p);
      }
      if (used.has(k)) {
        refuse("disulfide", `Cys${k} is already bonded (to Cys${used.get(k)}) — a cysteine forms one disulfide (“${p}”, position ${pAt + 1}).`, pAt + 1, p);
      }
    }
    if (a === b) refuse("disulfide", `“${p}” bonds Cys${a} to itself (position ${pAt + 1}).`, pAt + 1, p);
    used.set(a, b);
    used.set(b, a);
    out.disulfides.push([Math.min(a, b), Math.max(a, b)]);
    if (out.disulfides.length > MAX_DISULFIDES) {
      refuse("too-long", `More than ${MAX_DISULFIDES} disulfide bonds — this reader stops there.`, pAt + 1, p);
    }
  }
}

function parseNotation(input: string): Parsed {
  if (input.length > MAX_PEPTIDE_INPUT) {
    refuse("too-long", `Input is ${input.length} characters; the peptide reader stops at ${MAX_PEPTIDE_INPUT}.`, null, "");
  }
  const norm = normalise(input);
  const semi = norm.indexOf(";");
  const headRaw = semi < 0 ? norm : norm.slice(0, semi);
  const lead = headRaw.length - headRaw.trimStart().length;
  const head = headRaw.trim();
  if (!head) refuse("empty", "No peptide sequence.", null, "");

  const out: Parsed = {
    residues: [],
    positions: [],
    nTerm: "free",
    cTerm: "free",
    cyclic: false,
    notes: [],
    disulfides: [],
    disulfideAll: 0,
  };

  // --- cyclo forms ---------------------------------------------------------
  let body = head;
  let bodyAt = lead;
  const cy = /^[cC]yclo\s*(-?)\s*([([])?/.exec(head);
  if (cy && cy[2]) {
    const open = cy[0].length - 1;
    const close = matchBracket(head, open);
    if (close < 0) refuse("bracket", `Unclosed “${head[open]}” at position ${lead + open + 1}.`, lead + open + 1, head[open]);
    if (close !== head.length - 1) {
      const p = lead + close + 2;
      refuse("cyclo", `Text after the closing “${head[close]}” of cyclo(…) at position ${p} — a head-to-tail cyclic peptide has no termini to add (Ac-, -NH2 are refused).`, p, head.slice(close + 1));
    }
    out.cyclic = true;
    body = head.slice(open + 1, close);
    bodyAt = lead + open + 1;
  } else if (cy && cy[1] === "-") {
    out.cyclic = true;
    body = head.slice(cy[0].length);
    bodyAt = lead + cy[0].length;
  } else if (/^c\[/.test(head) && matchBracket(head, 1) === head.length - 1) {
    out.cyclic = true;
    body = head.slice(2, -1);
    bodyAt = lead + 2;
  } else if (/^cyclo/i.test(head)) {
    if (/^CYCLO/.test(head)) {
      refuse("cyclo", `“CYCLO” at position ${lead + 1} would read as the residues Cys-Tyr-Cys-Leu-Pyl. For a cyclic peptide write cyclo(…); if those residues are meant, space them (C Y C L O …).`, lead + 1, "CYCLO");
    }
    refuse("cyclo", `“${head.slice(0, 5)}” at position ${lead + 1} must be followed by (…), […] or a hyphen — written solid it would read as Cys-Tyr-Cys-Leu-Pyl. Write cyclo(${head.slice(5)}).`, lead + 1, head.slice(0, 5));
  }
  const again = body.search(/cyclo/i);
  if (again >= 0) refuse("cyclo", `A second “cyclo” at position ${bodyAt + again + 1} — only one head-to-tail ring is read.`, bodyAt + again + 1, "cyclo");

  // --- tokens and termini --------------------------------------------------
  let toks = splitTokens(body, bodyAt);
  if (!toks.length) refuse("empty", "No residues inside the brackets.", bodyAt + 1, "");
  const isN = (s: string): boolean => s === "Ac" || /^\[acetyl\]$/i.test(s);
  const isC = (s: string): boolean => s === "OH" || s === "NH2" || /^\[amidated\]$/i.test(s);
  let hasCTermToken = false;
  let hasHToken = false;
  let hasOH = false;
  if (toks.length > 1 && isC(toks[toks.length - 1].text)) {
    const t = toks[toks.length - 1];
    if (out.cyclic) refuse("cyclo", `“-${t.text}” at position ${t.start + 1}: a head-to-tail cyclic peptide has no C-terminus.`, t.start + 1, t.text);
    if (t.text !== "OH") out.cTerm = "amide";
    hasCTermToken = true;
    hasOH = t.text === "OH";
    toks = toks.slice(0, -1);
  }
  if (toks.length > 1 && isN(toks[0].text)) {
    const t = toks[0];
    if (out.cyclic) refuse("cyclo", `“${t.text}-” at position ${t.start + 1}: a head-to-tail cyclic peptide has no N-terminus to acetylate.`, t.start + 1, t.text);
    out.nTerm = "acetyl";
    toks = toks.slice(1);
  }
  for (const t of toks) {
    if (isN(t.text) || isC(t.text)) {
      refuse("termini", `“${t.text}” at position ${t.start + 1} is a terminal group — Ac-/H- belong at the start, -NH2/-OH at the end.`, t.start + 1, t.text);
    }
  }

  const stripMod = (s: string): string => s.replace(/(\[[^\]]*\]|\([^)]*\))$/, "");
  for (const t of toks) {
    const core = stripMod(t.text);
    const what = core.length === 3 ? NONSTANDARD_THREE[core.toUpperCase()] : undefined;
    if (what) {
      const nice = core[0].toUpperCase() + core.slice(1).toLowerCase();
      refuse(
        "nonstandard",
        `“${core}” at position ${t.start + 1} reads as ${nice} (${what}), which is not one of the 20 standard residues (or Sec/Pyl) and has no structure here. If one-letter codes were meant, space them (${core.split("").join(" ")}).`,
        t.start + 1,
        core
      );
    }
  }
  const three = toks.some((t) => {
    const core = stripMod(t.text);
    return (core.length === 3 && !!BY_THREE[core.toUpperCase()]) || core === "pGlu" || core === "Glp" || core === "Pyr";
  });

  if (toks.length > 1 && toks[0].text === "H") {
    const t = toks[0];
    if (out.cyclic) refuse("cyclo", `“H-” at position ${t.start + 1}: a head-to-tail cyclic peptide has no free N-terminus.`, t.start + 1, "H");
    if (three || hasCTermToken) {
      hasHToken = true;
      toks = toks.slice(1);
    } else if (toks[1].text.length > 1) {
      refuse(
        "ambiguous",
        `“H-” at position ${t.start + 1} is ambiguous: the free-amine terminus, or His joined by a hyphen? Write ${toks.map((x) => x.text).join("")} for His, or H-${toks.slice(1).map((x) => x.text).join("")}-OH for the free termini.`,
        t.start + 1,
        "H"
      );
    }
  }
  if (out.cyclic && toks.some((t) => t.text === "OH")) {
    const t = toks.find((x) => x.text === "OH")!;
    refuse("cyclo", `“OH” at position ${t.start + 1}: a head-to-tail cyclic peptide has no C-terminus.`, t.start + 1, "OH");
  }
  if (hasHToken && out.nTerm === "acetyl") refuse("termini", "Both Ac- and H- given for one N-terminus.", toks[0].start + 1, "H");
  // H- and -OH are standard in three-letter notation (accepted silently); in a
  // one-letter string they could also be His / Pyl-His, so the reading is said.
  if (hasHToken && !three) out.notes.push("H- read as the free N-terminal amine (not His).");
  if (hasOH && !three) out.notes.push("-OH read as the free C-terminal acid (not Pyl-His).");

  if (three) parseThreeLetter(out, toks, out.cyclic);
  else parseOneLetter(out, toks, out.cyclic);

  if (!out.residues.length) refuse("empty", "No residues.", bodyAt + 1, "");
  if (out.cyclic && out.residues.length < 2) {
    refuse("cyclo", "A head-to-tail cyclic peptide needs at least 2 residues.", bodyAt + 1, body);
  }
  const first = out.residues[0];
  if (out.nTerm === "acetyl" && first.mod && first.mod.endsWith("pyro-Glu")) {
    refuse("termini", "Ac- with an N-terminal pyroglutamate: pyroglutamate has no free amine to acetylate.", lead + 1, "Ac");
  }

  // --- clauses -------------------------------------------------------------
  if (semi >= 0) {
    const clauses = norm.slice(semi + 1).split(";");
    let base = semi + 1;
    for (const c of clauses) {
      if (c.trim()) parseDisulfideClause(c, base, out);
      base += c.length + 1;
    }
  }
  return out;
}

interface SmilesBuild {
  smiles: string | null;
  reason: string | null;
}

function residueHead(r: ReadResidue, index: number, label: string): string {
  if (r.mod === "Gln->pyro-Glu" || r.mod === "Glu->pyro-Glu") return "N1C(=O)CCC1";
  const aa = BY_ONE[r.code];
  if (aa.special) return "N1CCCC1"; // proline; its unit is N1CCCC1 + C(=O)
  if (aa.side === "") return "NC";
  const side = r.mod ? MOD_SIDE[`${r.code}:${r.mod}`] : aa.side;
  void index;
  return `NC(${side}${label})`;
}

/** Builds the SMILES; `withBonds` false gives the reduced (thiol) form. */
function assembleSmiles(p: Parsed, withBonds: boolean): SmilesBuild {
  const n = p.residues.length;
  const labelAt: string[] = new Array(n).fill("");
  if (withBonds && p.disulfides.length) {
    // Ring-closure labels %11..%99, reused once closed. %10 is the macrocycle.
    const free: number[] = [];
    for (let k = 99; k >= 11; k--) free.push(k);
    const partner = new Map<number, number>();
    for (const [a, b] of p.disulfides) {
      partner.set(a - 1, b - 1);
      partner.set(b - 1, a - 1);
    }
    const open = new Map<number, number>(); // residue index of the far end → label
    for (let i = 0; i < n; i++) {
      if (!partner.has(i)) continue;
      const j = partner.get(i)!;
      if (j > i) {
        const lab = free.pop();
        if (lab === undefined) return { smiles: null, reason: "Too many simultaneously open disulfide bonds to write as SMILES ring closures (89 is the limit)." };
        open.set(j, lab);
        labelAt[i] = `%${lab}`;
      } else {
        const lab = open.get(i)!;
        open.delete(i);
        labelAt[i] = `%${lab}`;
        free.push(lab);
      }
    }
  }
  let s = p.nTerm === "acetyl" ? "CC(=O)" : "";
  for (let i = 0; i < n; i++) {
    let head = residueHead(p.residues[i], i, labelAt[i]);
    if (i === 0 && p.cyclic) head = "N%10" + head.slice(1);
    const carbonyl = i === n - 1 && p.cyclic ? "C%10(=O)" : "C(=O)";
    s += head + carbonyl;
  }
  if (!p.cyclic) s += p.cTerm === "amide" ? "N" : "O";
  return { smiles: s, reason: null };
}

function oclFormula(smiles: string): string {
  // No coordinates / stereo perception: the formula needs neither, and OCL's
  // 2D layout is superlinear (12.5 s for a 200-residue SMILES vs 0.04 s without).
  return Molecule.fromSmiles(smiles, { noCoordinates: true, noStereo: true }).getMolecularFormula().formula;
}

function typesetComposition(c: Composition): string {
  // Signed delta: "+HPO₃", "−H₂", "+HN −O".
  const pos: Composition = {};
  const neg: Composition = {};
  for (const [el, k] of Object.entries(c)) {
    if (k > 0) pos[el] = k;
    else if (k < 0) neg[el] = -k;
  }
  const parts: string[] = [];
  if (Object.keys(pos).length) parts.push("+" + typesetFormula(pos));
  if (Object.keys(neg).length) parts.push("−" + typesetFormula(neg));
  return parts.join(" ");
}

function displayOf(p: Parsed, three: boolean): string {
  const resText = p.residues.map((r) => {
    if (three) {
      // Pyroglutamate is one residue whichever amino acid it formed from (the same composition): pGlu, never
      // "Glu[Glu->pyro-Glu]" in three-letter form.
      if (r.mod === "Gln->pyro-Glu" || r.mod === "Glu->pyro-Glu") return "pGlu";
      return r.mod ? `${r.three}[${r.mod}]` : r.three;
    }
    return r.mod ? `${r.code}[${r.mod}]` : r.code;
  });
  let core = three ? resText.join("-") : resText.join("");
  if (p.cyclic) core = `cyclo(${core})`;
  else {
    const nt = p.nTerm === "acetyl" ? "Ac-" : three && !(p.residues[0].mod || "").endsWith("pyro-Glu") ? "H-" : "";
    const ct = p.cTerm === "amide" ? "-NH₂" : three ? "-OH" : "";
    core = nt + core + ct;
  }
  if (p.disulfides.length) core += "; disulfide " + p.disulfides.map(([a, b]) => `${a}-${b}`).join(", ");
  else if (p.disulfideAll) core += "; disulfide all";
  return core;
}

/**
 * Reads modified / cyclic / disulfide-bridged peptide notation and returns
 * formula, monoisotopic and average mass, the modifications applied (with
 * Unimod accessions) and a SMILES whose OCL formula has been checked against
 * the composition — or a refusal naming the token and its position.
 */
export function readPeptide(input: string): PeptideReading | PeptideRefusal {
  let p: Parsed;
  try {
    p = parseNotation(input ?? "");
  } catch (e) {
    if (e instanceof Refused) return e.r;
    throw e;
  }

  // --- composition ---------------------------------------------------------
  let comp: Composition = { ...WATER };
  for (const r of p.residues) comp = addComposition(comp, RESIDUE_COMPOSITION[r.code]);
  const mods = new Map<string, AppliedModification>();
  const addMod = (key: string, def: Omit<AppliedModification, "sites" | "count">, site: string, delta: Composition): void => {
    comp = addComposition(comp, delta);
    const m = mods.get(key) || { ...def, sites: [], count: 0 };
    m.sites.push(site);
    m.count++;
    mods.set(key, m);
  };
  const unimod = (k: ModKey, site: string): void => {
    const d = MODS[k];
    addMod(
      k,
      { name: `${k} (${d.label})`, accession: `UNIMOD:${d.accession}`, deltaMono: d.unimodMono, deltaAvg: d.unimodAvg, deltaComposition: typesetComposition(d.composition) },
      site,
      d.composition
    );
  };
  p.residues.forEach((r, i) => {
    if (r.mod) unimod(r.mod, `${r.code}${i + 1}`);
  });
  if (p.nTerm === "acetyl") unimod("Acetyl", "N-term");
  if (p.cTerm === "amide") unimod("Amidated", "C-term");
  if (p.cyclic) {
    addMod(
      "cyclo",
      { name: "Head-to-tail cyclisation (amide bond from the C-terminal carbonyl to the N-terminal amine)", accession: null, deltaMono: monoMass(CYCLISATION), deltaAvg: -18.0153, deltaComposition: "−H₂O" },
      `${p.residues[p.residues.length - 1].code}${p.residues.length}→${p.residues[0].code}1`,
      CYCLISATION
    );
  }
  const bondCount = p.disulfides.length || p.disulfideAll;
  const ssDef = { name: "Disulfide bond (2 × Dehydro)", accession: "UNIMOD:374", deltaMono: DISULFIDE_MONO, deltaAvg: DISULFIDE_AVG, deltaComposition: "−H₂" };
  for (const [a, b] of p.disulfides) addMod("ss", ssDef, `C${a}–C${b}`, DISULFIDE);
  for (let k = 0; k < p.disulfideAll; k++) addMod("ss", ssDef, "pairing not given", DISULFIDE);

  // --- structure + cross-check --------------------------------------------
  const notes = [...p.notes];
  let smiles: string | null = null;
  let structureRefusal: string | null = null;
  const formula = hillFormula(comp);
  const heavy = Object.entries(comp).reduce((s, [el, k]) => (el === "H" ? s : s + k), 0);
  if (heavy > MAX_CHECKED_HEAVY_ATOMS) {
    // Bound TIME, not residues: the OCL step scales with atoms (cyclo(W×998)
    // took 12.6 s). The composition arithmetic is exact without it, so the
    // mass stands; the structure is neither drawn nor cross-checked.
    structureRefusal = `${heavy} heavy atoms — above the ${MAX_CHECKED_HEAVY_ATOMS}-atom limit for drawing and cross-checking the structure. The formula and masses are computed from residue compositions and are exact; no structure is offered.`;
    notes.push("Structure not drawn or cross-checked (too large); formula and masses come from the composition arithmetic alone.");
  } else if (p.disulfideAll) {
    const n = p.disulfideAll * 2;
    const ways = pairingCount(n);
    structureRefusal = `${n} cysteines admit ${ways === null ? "very many" : ways} pairings; the mass is the same for every one, the structure is not — give the pairing (e.g. ; disulfide 1-6, 3-11) to draw it.`;
    const reduced = assembleSmiles(p, false).smiles!;
    const want = hillFormula(addComposition(comp, DISULFIDE, -p.disulfideAll));
    const got = oclFormula(reduced);
    if (got !== want) {
      return { ok: false, kind: "cross-check", message: `Internal cross-check failed: the drawn structure's formula ${got} differs from the composition ${want}. No mass is reported.`, position: null, token: "" };
    }
  } else {
    const built = assembleSmiles(p, true);
    if (built.smiles) {
      const got = oclFormula(built.smiles);
      if (got !== formula) {
        return { ok: false, kind: "cross-check", message: `Internal cross-check failed: the drawn structure's formula ${got} differs from the composition ${formula}. No mass is reported.`, position: null, token: "" };
      }
      smiles = built.smiles;
    } else structureRefusal = built.reason;
  }
  if (p.residues.some((r) => r.mod === "Deamidated")) {
    notes.push("Deamidation is drawn as Asp/Glu; the isoAsp product has the same mass but a different constitution.");
  }
  notes.push("Monoisotopic mass from NIST isotope masses; average mass from IUPAC conventional atomic weights. Modification deltas listed are Unimod's.");

  const first = p.residues[0];
  const nTerminus: PeptideReading["nTerminus"] = p.cyclic
    ? "none (head-to-tail cyclic)"
    : first.mod === "Gln->pyro-Glu" || first.mod === "Glu->pyro-Glu"
      ? "pyroglutamate"
      : p.nTerm === "acetyl"
        ? "acetyl"
        : "free amine";
  const cTerminus: PeptideReading["cTerminus"] = p.cyclic ? "none (head-to-tail cyclic)" : p.cTerm === "amide" ? "amide" : "free acid";

  return {
    ok: true,
    sequence: p.residues.map((r) => r.code).join(""),
    residues: p.residues,
    length: p.residues.length,
    display: displayOf(p, false),
    threeLetter: displayOf(p, true),
    nTerminus,
    cTerminus,
    cyclic: p.cyclic,
    disulfides: p.disulfides,
    disulfideCount: bondCount,
    disulfidePairingKnown: !p.disulfideAll,
    cystinePairs: bondCount,
    composition: comp,
    formula,
    formulaTypeset: typesetFormula(comp),
    monoisotopic: monoMass(comp),
    average: averageMass(comp),
    modifications: [...mods.values()],
    smiles,
    structureRefusal,
    stereo: PEPTIDE_STEREO_NOTE,
    notes,
  };
}

/**
 * The proteinogenic amino acids, for a reference/legend in the UI — the 20
 * standard ones plus Sec and Pyl, flagged.
 */
export function aminoAcidTable(): { one: string; three: string; name: string; nonstandard: boolean }[] {
  return AMINO_ACIDS.map((a) => ({ one: a.one, three: a.three, name: a.name, nonstandard: !!a.nonstandard }));
}
