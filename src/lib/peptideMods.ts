// Peptide modification data and composition arithmetic — the mass half of the
// modified/cyclic peptide reader in peptide.ts (v2.137.0, SCOPE-CHEMBIO-BATCH §B5).
//
// Everything here is COMPOSITION first: a residue or a modification is an
// element-count map, and every mass is computed from those counts. Monoisotopic
// masses use the NIST element masses below (the same values as massspec.ts's
// unexported ISOTOPES table); average masses use the IUPAC conventional atomic
// weights in chemValidate.ts `PERIODIC`.
//
// Unimod values (accession, composition, mono and average delta) were read off
// unimod.org on 2026-10-14 for every entry in MODS. They are NOT trusted as
// typed: at module load each one is re-derived from its composition and the
// module throws if the monoisotopic delta disagrees by more than 5e-6 (Unimod
// prints 6 d.p.) or the average by more than 0.002 (Unimod's average weights
// are not IUPAC's conventional ones; the largest gap here is Phospho, 0.0009).
// Pure functions; no Office.js; no OCL.

import { PERIODIC } from "./chemValidate";

/** Element → atom count. Negative counts are allowed in deltas. */
export type Composition = Record<string, number>;

/** NIST monoisotopic masses (most abundant isotope) for the 7 peptide elements. */
export const MONO_MASS: Record<string, number> = {
  C: 12.0,
  H: 1.0078250319,
  N: 14.0030740052,
  O: 15.9949146221,
  S: 31.97207069,
  P: 30.97376151,
  Se: 79.9165218,
};

/** Monoisotopic mass of a composition (a delta may be negative). */
export function monoMass(c: Composition): number {
  let m = 0;
  for (const [el, n] of Object.entries(c)) {
    const mm = MONO_MASS[el];
    if (mm === undefined) throw new Error(`No monoisotopic mass for element ${el}`);
    m += mm * n;
  }
  return m;
}

/** Average mass from IUPAC conventional atomic weights (chemValidate PERIODIC). */
export function averageMass(c: Composition): number {
  let m = 0;
  for (const [el, n] of Object.entries(c)) {
    const w = PERIODIC[el];
    if (w === undefined) throw new Error(`No atomic weight for element ${el}`);
    m += w * n;
  }
  return m;
}

/** a + k·b, dropping zero counts. */
export function addComposition(a: Composition, b: Composition, k = 1): Composition {
  const out: Composition = { ...a };
  for (const [el, n] of Object.entries(b)) {
    const v = (out[el] || 0) + k * n;
    if (v === 0) delete out[el];
    else out[el] = v;
  }
  return out;
}

/** Parses "C2H3NO" / "H-1N-1O" (signed counts allowed) into a Composition. */
export function parseComposition(s: string): Composition {
  const out: Composition = {};
  const re = /([A-Z][a-z]?)(-?\d*)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === "") break;
    if (m.index !== consumed) throw new Error(`Bad composition ${s}`);
    consumed = m.index + m[0].length;
    const n = m[2] === "" ? 1 : m[2] === "-" ? -1 : parseInt(m[2], 10);
    out[m[1]] = (out[m[1]] || 0) + n;
  }
  if (consumed !== s.length) throw new Error(`Bad composition ${s}`);
  return out;
}

/** Hill order: C, H, then the rest alphabetically. Zero counts omitted. */
export function hillFormula(c: Composition): string {
  const els = Object.keys(c).filter((e) => c[e] !== 0);
  const hasC = els.includes("C");
  const order = hasC
    ? ["C", "H"].filter((e) => els.includes(e)).concat(els.filter((e) => e !== "C" && e !== "H").sort())
    : els.slice().sort();
  return order.map((e) => (c[e] === 1 ? e : `${e}${c[e]}`)).join("");
}

const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };

/** Typeset Hill formula (subscript counts): C₂₂H₃₅N₉O₉. */
export function typesetFormula(c: Composition): string {
  return hillFormula(c).replace(/\d/g, (d) => SUB[d]);
}

/** Signed delta for display with a TRUE minus: "+79.966331", "−0.984016". */
export function signedMass(x: number, dp: number): string {
  const s = Math.abs(x).toFixed(dp);
  return (x < 0 ? "−" : "+") + s;
}

/** Composition of each residue (free amino acid − H₂O). Peptide = Σ residues + H₂O. */
export const RESIDUE_COMPOSITION: Record<string, Composition> = {
  G: parseComposition("C2H3NO"),
  A: parseComposition("C3H5NO"),
  V: parseComposition("C5H9NO"),
  L: parseComposition("C6H11NO"),
  I: parseComposition("C6H11NO"),
  P: parseComposition("C5H7NO"),
  F: parseComposition("C9H9NO"),
  W: parseComposition("C11H10N2O"),
  M: parseComposition("C5H9NOS"),
  S: parseComposition("C3H5NO2"),
  T: parseComposition("C4H7NO2"),
  C: parseComposition("C3H5NOS"),
  Y: parseComposition("C9H9NO2"),
  N: parseComposition("C4H6N2O2"),
  Q: parseComposition("C5H8N2O2"),
  D: parseComposition("C4H5NO3"),
  E: parseComposition("C5H7NO3"),
  K: parseComposition("C6H12N2O"),
  R: parseComposition("C6H12N4O"),
  H: parseComposition("C6H7N3O"),
  U: parseComposition("C3H5NOSe"),
  O: parseComposition("C12H19N3O2"),
};

export const WATER: Composition = { H: 2, O: 1 };

export type ModKey =
  | "Phospho"
  | "Acetyl"
  | "Amidated"
  | "Gln->pyro-Glu"
  | "Glu->pyro-Glu"
  | "Oxidation"
  | "Deamidated"
  | "Dehydro";

export interface ModDef {
  key: ModKey;
  /** Unimod accession number (UNIMOD:n). */
  accession: number;
  /** Unimod composition, signed. */
  composition: Composition;
  /** Unimod's printed deltas (unimod.org, read 2026-10-14). */
  unimodMono: number;
  unimodAvg: number;
  /** One-letter residues this reader accepts the modification on (side chain). */
  residues: string[];
  /** Plain-language description for the modification list. */
  label: string;
}

export const MODS: Record<ModKey, ModDef> = {
  Phospho: {
    key: "Phospho",
    accession: 21,
    composition: parseComposition("HO3P"),
    unimodMono: 79.966331,
    unimodAvg: 79.9799,
    residues: ["S", "T", "Y"],
    label: "phosphorylation",
  },
  Acetyl: {
    key: "Acetyl",
    accession: 1,
    composition: parseComposition("C2H2O"),
    unimodMono: 42.010565,
    unimodAvg: 42.0367,
    residues: ["K"],
    label: "acetylation",
  },
  Amidated: {
    key: "Amidated",
    accession: 2,
    composition: parseComposition("HNO-1"),
    unimodMono: -0.984016,
    unimodAvg: -0.9848,
    residues: [],
    label: "C-terminal amidation",
  },
  "Gln->pyro-Glu": {
    key: "Gln->pyro-Glu",
    accession: 28,
    composition: parseComposition("H-3N-1"),
    unimodMono: -17.026549,
    unimodAvg: -17.0305,
    residues: ["Q"],
    label: "pyroglutamate (from N-terminal Gln)",
  },
  "Glu->pyro-Glu": {
    key: "Glu->pyro-Glu",
    accession: 27,
    composition: parseComposition("H-2O-1"),
    unimodMono: -18.010565,
    unimodAvg: -18.0153,
    residues: ["E"],
    label: "pyroglutamate (from N-terminal Glu)",
  },
  Oxidation: {
    key: "Oxidation",
    accession: 35,
    composition: parseComposition("O"),
    unimodMono: 15.994915,
    unimodAvg: 15.9994,
    residues: ["M"],
    label: "oxidation (methionine sulfoxide)",
  },
  Deamidated: {
    key: "Deamidated",
    accession: 7,
    composition: parseComposition("H-1N-1O"),
    unimodMono: 0.984016,
    unimodAvg: 0.9848,
    residues: ["N", "Q"],
    label: "deamidation",
  },
  Dehydro: {
    key: "Dehydro",
    accession: 374,
    composition: parseComposition("H-1"),
    unimodMono: -1.007825,
    unimodAvg: -1.0079,
    residues: ["C"],
    label: "disulfide bond (2 × Dehydro per bond)",
  },
};

/** Head-to-tail cyclisation: a condensation, −H₂O. No Unimod accession. */
export const CYCLISATION: Composition = { H: -2, O: -1 };
/** One disulfide bond = 2 × Dehydro = −H₂. */
export const DISULFIDE: Composition = { H: -2 };

export const MONO_TOLERANCE = 5e-6;
export const AVG_TOLERANCE = 0.002;

export interface ModCheck {
  key: ModKey;
  derivedMono: number;
  derivedAvg: number;
  unimodMono: number;
  unimodAvg: number;
  ok: boolean;
}

/** Re-derives each Unimod delta from its composition. Run at load; exported for tests. */
export function verifyModDeltas(): ModCheck[] {
  return (Object.keys(MODS) as ModKey[]).map((key) => {
    const d = MODS[key];
    const derivedMono = monoMass(d.composition);
    const derivedAvg = averageMass(d.composition);
    const ok =
      Math.abs(derivedMono - d.unimodMono) <= MONO_TOLERANCE && Math.abs(derivedAvg - d.unimodAvg) <= AVG_TOLERANCE;
    return { key, derivedMono, derivedAvg, unimodMono: d.unimodMono, unimodAvg: d.unimodAvg, ok };
  });
}

const failed = verifyModDeltas().filter((c) => !c.ok);
if (failed.length) {
  throw new Error(
    `peptideMods: Unimod delta does not match its composition for ${failed.map((f) => f.key).join(", ")}`
  );
}

/** Looks a bracket name up: ProForma/Unimod name (case-insensitive) or "UNIMOD:n". */
export function lookupMod(name: string): ModDef | null {
  // "→" accepted for "->", so a typeset Q[Gln→pyro-Glu] re-parses.
  const t = name.trim().replace(/→/g, "->");
  const acc = /^unimod:(\d+)$/i.exec(t);
  if (acc) {
    const n = parseInt(acc[1], 10);
    const hit = (Object.values(MODS) as ModDef[]).find((m) => m.accession === n && m.key !== "Dehydro");
    return hit || null;
  }
  const lower = t.toLowerCase();
  const hit = (Object.values(MODS) as ModDef[]).find((m) => m.key.toLowerCase() === lower && m.key !== "Dehydro");
  return hit || null;
}

/** The bracket names the reader accepts, for refusal messages. */
export const SUPPORTED_BRACKET_NAMES = [
  "Phospho (S, T, Y)",
  "Oxidation (M)",
  "Acetyl (K; N-terminal as [Acetyl]- or Ac-)",
  "Deamidated (N, Q)",
  "Gln->pyro-Glu (N-terminal Q)",
  "Glu->pyro-Glu (N-terminal E)",
  "Amidated (C-terminal, as -[Amidated] or -NH2)",
];

/** (n−1)!! perfect matchings of n cysteines (n even); null past 2^53. */
export function pairingCount(n: number): number | null {
  if (n % 2 !== 0 || n < 0) return 0;
  let r = 1;
  for (let k = n - 1; k > 1; k -= 2) {
    r *= k;
    if (!Number.isSafeInteger(r)) return null;
  }
  return r;
}
