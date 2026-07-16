// 1H and 13C NMR chemical-shift prediction from structure.
//
// IMPORTANT — honesty (the same standard as pka.ts): this is an ADDITIVITY
// model, not a quantum-chemical or HOSE-code/ML prediction. Structure detection
// is exact (it walks OpenChemLib's atom/bond graph, so an ester is never
// mistaken for a ketone), but the shift VALUES come from published empirical
// increment tables and carry real uncertainty:
//
//   13C  ±2-4 ppm typical for common environments; worse for crowded /
//        polysubstituted / strained carbons.
//   1H   ±0.2-0.4 ppm typical; OH / NH protons are concentration-, solvent- and
//        temperature-dependent and are reported as nominal ranges only.
//
// The model is deliberately transparent about where it is weak, and the UI must
// carry the caveat. Predicted spectra are an assignment aid — they never replace
// an acquired spectrum.
//
// Sources for the increment tables (standard, widely reproduced):
//   * Grant & Paul additivity for sp3 alkane carbons.
//   * Benzene substituent increments (ipso/ortho/meta/para) — Pretsch, Bühlmann
//     & Badertscher, "Structure Determination of Organic Compounds", tables for
//     13C and 1H aromatic substituent effects.
//   * Shoolery-type additivity for CH/CH2/CH3 proton shifts.
//   * Ethylene substituent increments for alkene carbons.
//
// Pure functions; fully offline; no Office.js.

import { Molecule } from "openchemlib";
import {
  neighbors,
  isCarbonyl,
  carbonylKind,
  isConjugated,
  distancesFrom,
  aromaticSubstituents,
  aromaticRingDistances,
  isFusedAromatic,
  classifySubstituent,
  isPlainAlkylCarbon,
  parseToMolecule,
  symmetryClasses,
  SubstKey,
} from "./molgraph";

export type Nucleus = "1H" | "13C";

export interface NmrSignal {
  /** Predicted chemical shift, ppm (TMS = 0). */
  shift: number;
  /** Number of equivalent nuclei giving rise to this signal. */
  count: number;
  /** Multiplicity from the n+1 rule ("s", "d", "t", "q", "m", ...). 13C is proton-decoupled. */
  multiplicity: string;
  /** Human-readable environment, e.g. "CH3 (on C=O)" or "aromatic CH". */
  assignment: string;
  /** Atom indices contributing to this signal. */
  atoms: number[];
  /** True when the value is a nominal range rather than an additivity estimate (OH/NH). */
  variable?: boolean;
}

export interface NmrResult {
  smiles: string;
  nucleus: Nucleus;
  signals: NmrSignal[];
  /** Structural situations where this model is known to be weak, for the UI to surface. */
  caveats: string[];
}

// ---------------------------------------------------------------------------
// 13C — aromatic substituent increments, relative to benzene (128.5 ppm).
// [ipso, ortho, meta, para]
// ---------------------------------------------------------------------------
const AR13C: Partial<Record<SubstKey, [number, number, number, number]>> = {
  CH3: [9.3, 0.7, -0.1, -2.9],
  alkyl: [15.7, -0.6, -0.1, -2.8],
  OH: [26.9, -12.7, 1.4, -7.3],
  OR: [31.4, -14.4, 1.0, -7.7],
  OAc: [22.4, -7.1, 0.4, -3.2],
  NH2: [18.0, -13.3, 0.9, -9.8],
  NR2: [21.0, -15.7, 0.8, -11.8],
  NHAc: [9.7, -8.1, 0.2, -4.4],
  NO2: [19.9, -4.9, 0.9, 6.1],
  CN: [-16.0, 3.6, 0.6, 4.3],
  CHO: [8.2, 1.2, 0.5, 5.8],
  COR: [8.9, 0.0, -0.1, 4.4],
  COOH: [2.1, 1.5, 0.0, 5.1],
  COOR: [2.0, 1.2, -0.1, 4.3],
  CONH2: [5.4, -0.5, -0.5, 5.0],
  F: [34.8, -12.9, 1.4, -4.5],
  Cl: [6.2, 0.4, 1.3, -1.9],
  Br: [-5.5, 3.4, 1.7, -1.6],
  I: [-34.1, 8.9, 1.6, -1.1],
  SH: [2.3, 0.6, 0.2, -3.3],
  SR: [9.9, -2.0, 0.1, -3.7],
  Ph: [13.0, -1.1, 0.5, -1.0],
  vinyl: [9.5, -2.0, 0.2, -0.5],
  alkynyl: [-6.1, 3.8, 0.4, -0.2],
};

// ---------------------------------------------------------------------------
// 1H — aromatic substituent increments, relative to benzene (7.26 ppm).
// [ortho, meta, para]
// ---------------------------------------------------------------------------
const AR1H: Partial<Record<SubstKey, [number, number, number]>> = {
  CH3: [-0.17, -0.09, -0.18],
  alkyl: [-0.14, -0.06, -0.17],
  OH: [-0.56, -0.12, -0.45],
  OR: [-0.48, -0.09, -0.44],
  OAc: [-0.25, 0.03, -0.13],
  NH2: [-0.75, -0.25, -0.65],
  NR2: [-0.66, -0.18, -0.67],
  NHAc: [-0.12, -0.07, -0.28],
  NO2: [0.95, 0.26, 0.38],
  CN: [0.36, 0.18, 0.28],
  CHO: [0.58, 0.21, 0.27],
  COR: [0.64, 0.09, 0.3],
  COOH: [0.85, 0.18, 0.25],
  COOR: [0.71, 0.11, 0.21],
  CONH2: [0.61, 0.1, 0.17],
  F: [-0.26, 0.0, -0.2],
  Cl: [0.03, -0.02, -0.09],
  Br: [0.18, -0.08, -0.04],
  I: [0.39, -0.21, 0.0],
  SH: [-0.08, -0.16, -0.22],
  SR: [-0.08, -0.1, -0.24],
  Ph: [0.3, 0.12, 0.1],
  vinyl: [0.06, -0.03, -0.1],
  alkynyl: [0.15, -0.02, -0.01],
};

// ---------------------------------------------------------------------------
// 13C — heteroatom/functional substituent effects on sp3 carbons (α, β, γ).
// ---------------------------------------------------------------------------
const SP3_13C: Partial<Record<SubstKey, [number, number, number]>> = {
  OH: [48, 10, -5],
  OR: [58, 8, -4],
  OAc: [51, 6, -3],
  NH2: [29, 11, -5],
  NR2: [42, 6, -3],
  NHAc: [28, 8, -3],
  NO2: [63, 4, -3],
  CN: [3, 3, -3],
  CHO: [30, -1, -2],
  COR: [30, 1, -2],
  COOH: [21, 3, -2],
  COOR: [20, 3, -2],
  CONH2: [22, 2, -1],
  F: [68, 9, -4],
  Cl: [31, 11, -4],
  Br: [20, 11, -3],
  I: [-6, 11, -1],
  SH: [11, 12, -6],
  SR: [20, 7, -3],
  Ph: [23, 9, -2],
  vinyl: [20, 6, -2],
  alkynyl: [4, 6, -2],
};

// ---------------------------------------------------------------------------
// 1H — α substituent effects on CH3 / CH2 / CH (Shoolery-type).
// ---------------------------------------------------------------------------
const SP3_1H: Partial<Record<SubstKey, number>> = {
  OH: 2.5,
  OR: 2.4,
  OAc: 3.1,
  NH2: 1.6,
  NR2: 1.6,
  NHAc: 2.1,
  NO2: 3.1,
  CN: 1.6,
  CHO: 1.2,
  COR: 1.2,
  COOH: 1.1,
  COOR: 1.1,
  CONH2: 1.0,
  F: 3.2,
  Cl: 2.2,
  Br: 2.1,
  I: 1.9,
  SH: 1.3,
  SR: 1.3,
  Ph: 1.5,
  vinyl: 0.9,
  alkynyl: 0.9,
};

/** β effect on 1H (substituent one carbon further away) — small and uniform. */
const BETA_1H: Partial<Record<SubstKey, number>> = {
  OH: 0.3,
  OR: 0.3,
  OAc: 0.4,
  NO2: 0.5,
  F: 0.3,
  Cl: 0.4,
  Br: 0.4,
  I: 0.4,
  CHO: 0.2,
  COR: 0.2,
  COOH: 0.2,
  COOR: 0.2,
  CN: 0.3,
  Ph: 0.2,
};

/** 13C base shifts for carbonyl carbons by class (unconjugated). */
const CARBONYL_13C: Record<string, number> = {
  ketone: 205,
  aldehyde: 199,
  acid: 178,
  ester: 171,
  amide: 172,
  acidHalide: 170,
  anhydride: 167,
  carbonate: 156,
  urea: 158,
  carbamate: 156,
  thioester: 193,
  isocyanate: 122,
};

function hybridization(mol: Molecule, a: number): "sp" | "sp2" | "sp3" {
  const nbrs = neighbors(mol, a);
  if (nbrs.some((nb) => nb.order === 3)) return "sp";
  if (mol.isAromaticAtom(a)) return "sp2";
  if (nbrs.some((nb) => nb.order === 2)) return "sp2";
  return "sp3";
}

/**
 * Ring position relative to `a`: 1 = ortho, 2 = meta, 3 = para. Walks aromatic
 * bonds only, so a biphenyl's second ring is a substituent rather than an
 * extension of this ring (see aromaticRingDistances).
 */
function aromaticPositions(mol: Molecule, a: number): number[] {
  return aromaticRingDistances(mol, a);
}

/**
 * Flags the aromatic-model limits that apply to this ring, so the UI can say so.
 * The benzene increment tables assume an isolated six-membered carbocycle; ring
 * fusion and ring heteroatoms both break that assumption.
 */
function aromaticCaveats(mol: Molecule, a: number, dist: number[], caveats: Set<string>): void {
  if (isFusedAromatic(mol, a)) {
    caveats.add(
      "Fused aromatic ring (naphthalene-type): benzene increments assume an isolated ring, so fused-ring shifts are approximate (±5 ppm)."
    );
  }

  // A substituent with no increment contributes ZERO — the shift comes out as if
  // the group were not on the ring at all. That silence was the gap: a boronic
  // acid, a phosphonate or a nitroso group simply vanished from the prediction and
  // nothing said so. Name the group so the reader knows what was ignored.
  const unknown = new Set<string>();
  for (let b = 0; b < mol.getAllAtoms(); b++) {
    if (!mol.isAromaticAtom(b) || dist[b] < 0 || dist[b] > 3) continue;
    for (const s of aromaticSubstituents(mol, b)) {
      const key = classifySubstituent(mol, s, b);
      if (key === "other" || !AR13C[key]) unknown.add(mol.getAtomLabel(s));
    }
  }
  if (unknown.size) {
    caveats.add(
      `Substituent${unknown.size > 1 ? "s" : ""} on this ring (attached via ${[...unknown].join(", ")}) ` +
        "have no tabulated benzene increment, so they contributed NOTHING to the shift — " +
        "it is predicted as if they were absent. Expect a real error of tens of ppm for a " +
        "strongly donating or withdrawing group."
    );
  }

  for (let x = 0; x < mol.getAllAtoms(); x++) {
    if (dist[x] >= 0 && mol.isAromaticAtom(x) && mol.getAtomicNo(x) !== 6) {
      caveats.add("Heteroaromatic ring: benzene-based increments are approximate (±5-10 ppm).");
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 13C
// ---------------------------------------------------------------------------

function shift13C(mol: Molecule, a: number, caveats: Set<string>): { shift: number; assignment: string } {
  const hyb = hybridization(mol, a);
  const hCount = mol.getAllHydrogens(a);

  // --- Nitrile ------------------------------------------------------------
  const triple = neighbors(mol, a).find((nb) => nb.order === 3);
  if (triple) {
    if (mol.getAtomicNo(triple.atom) === 7) return { shift: 118.0, assignment: "C≡N (nitrile)" };
    // Alkyne: terminal CH ~ 68, substituted ~ 84.
    return hCount >= 1
      ? { shift: 68.0, assignment: "≡CH (terminal alkyne)" }
      : { shift: 84.0, assignment: "C≡C (alkyne)" };
  }

  // --- Carbonyl -----------------------------------------------------------
  const kind = carbonylKind(mol, a);
  if (kind) {
    let shift = CARBONYL_13C[kind] ?? 200;
    // Conjugation to an aromatic ring or C=C shifts C=O upfield ~6 ppm.
    if (isConjugated(mol, a) && (kind === "ketone" || kind === "aldehyde")) shift -= 6;
    else if (isConjugated(mol, a)) shift -= 2;
    const label: Record<string, string> = {
      ketone: "C=O (ketone)",
      aldehyde: "CHO (aldehyde)",
      acid: "COOH (carboxylic acid)",
      ester: "C=O (ester)",
      amide: "C=O (amide)",
      acidHalide: "C=O (acid halide)",
      anhydride: "C=O (anhydride)",
      carbonate: "C=O (carbonate)",
      urea: "C=O (urea)",
      carbamate: "C=O (carbamate)",
      thioester: "C=O (thioester)",
      isocyanate: "N=C=O (isocyanate)",
    };
    return { shift, assignment: label[kind] ?? "C=O" };
  }

  // --- Aromatic -----------------------------------------------------------
  if (mol.isAromaticAtom(a)) {
    if (mol.getAtomicNo(a) !== 6) return { shift: 150, assignment: "aromatic heteroatom C" };
    let shift = 128.5;
    const dist = aromaticPositions(mol, a);
    // Sum increments from every substituent on the ring system.
    for (let b = 0; b < mol.getAllAtoms(); b++) {
      if (!mol.isAromaticAtom(b)) continue;
      const d = dist[b];
      if (d < 0 || d > 3) continue;
      for (const s of aromaticSubstituents(mol, b)) {
        const key = classifySubstituent(mol, s, b);
        const inc = AR13C[key];
        if (!inc) continue;
        shift += inc[d];
      }
    }
    aromaticCaveats(mol, a, dist, caveats);
    return { shift, assignment: hCount >= 1 ? "aromatic CH" : "aromatic C (substituted)" };
  }

  // --- Alkene -------------------------------------------------------------
  if (hyb === "sp2") {
    const dbl = neighbors(mol, a).find((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 6);
    if (dbl) {
      // Ethylene 123.3 + α (this carbon) − β (far carbon) increments.
      let shift = 123.3;
      for (const nb of neighbors(mol, a)) {
        if (nb.atom === dbl.atom) continue;
        const key = classifySubstituent(mol, nb.atom, a);
        shift += alkeneAlpha(key);
      }
      for (const nb of neighbors(mol, dbl.atom)) {
        if (nb.atom === a) continue;
        const key = classifySubstituent(mol, nb.atom, dbl.atom);
        shift += alkeneBeta(key);
      }
      return { shift, assignment: hCount >= 1 ? "=CH (alkene)" : "=C (alkene, substituted)" };
    }
    // C=N / C=S and friends.
    return { shift: 160, assignment: "sp2 C (C=N / C=S)" };
  }

  // --- sp3: Grant-Paul additivity over the ALKANE SKELETON ----------------
  // δ = -2.3 + 9.1·nα + 9.4·nβ − 2.5·nγ + 0.3·nδ, counting only plain sp3
  // carbons reachable through plain sp3 carbons. Everything else (aryl, C=O,
  // CN, halogen, O, N ...) is a substituent hanging off the skeleton and is
  // accounted for once, by its increment — never by both.
  const skeleton = distancesFrom(mol, a, (x) => isPlainAlkylCarbon(mol, x));
  let nA = 0;
  let nB = 0;
  let nG = 0;
  let nD = 0;
  for (let b = 0; b < mol.getAllAtoms(); b++) {
    if (b === a) continue;
    switch (skeleton[b]) {
      case 1:
        nA++;
        break;
      case 2:
        nB++;
        break;
      case 3:
        nG++;
        break;
      case 4:
        nD++;
        break;
    }
  }
  let shift = -2.3 + 9.1 * nA + 9.4 * nB - 2.5 * nG + 0.3 * nD;

  // Substituent increments: for each skeleton carbon within γ of `a`, every
  // neighbour that is NOT part of the skeleton is a substituent root. Its
  // position (α/β/γ) is the skeleton distance of the carbon it hangs from.
  for (let s = 0; s < mol.getAllAtoms(); s++) {
    const d = skeleton[s];
    if (d < 0 || d > 2) continue; // α, β, γ  →  d = 0, 1, 2
    for (const nb of neighbors(mol, s)) {
      if (skeleton[nb.atom] >= 0) continue; // still the skeleton, already counted
      const key = classifySubstituent(mol, nb.atom, s);
      const inc = SP3_13C[key];
      if (!inc) continue;
      shift += inc[d];
    }
  }

  const label = hCount === 3 ? "CH3" : hCount === 2 ? "CH2" : hCount === 1 ? "CH" : "C (quaternary)";
  return { shift, assignment: label };
}

function alkeneAlpha(key: SubstKey): number {
  const t: Partial<Record<SubstKey, number>> = {
    CH3: 10.6,
    alkyl: 12.9,
    OH: 25,
    OR: 29,
    OAc: 18,
    NH2: 16,
    NR2: 16,
    Cl: 3,
    Br: -8,
    I: -38,
    F: 24,
    CN: -16,
    CHO: 13,
    COR: 15,
    COOH: 5,
    COOR: 6,
    Ph: 12,
    vinyl: 14,
  };
  return t[key] ?? 0;
}

function alkeneBeta(key: SubstKey): number {
  const t: Partial<Record<SubstKey, number>> = {
    CH3: -7.9,
    alkyl: -9.4,
    OH: -35,
    OR: -39,
    OAc: -27,
    NH2: -29,
    NR2: -29,
    Cl: -6,
    Br: -0.6,
    I: 7,
    F: -34,
    CN: 15,
    CHO: 13,
    COR: 6,
    COOH: 9,
    COOR: 7,
    Ph: -11,
    vinyl: -7,
  };
  return t[key] ?? 0;
}

// ---------------------------------------------------------------------------
// 1H
// ---------------------------------------------------------------------------

/** Shift of the protons attached to carbon `a`. */
function shift1HonCarbon(mol: Molecule, a: number, caveats: Set<string>): { shift: number; assignment: string } {
  const hCount = mol.getAllHydrogens(a);
  const nbrs = neighbors(mol, a);

  // Aldehyde H.
  if (carbonylKind(mol, a) === "aldehyde") {
    return { shift: isConjugated(mol, a) ? 9.9 : 9.7, assignment: "CHO (aldehyde)" };
  }

  // Aromatic H — benzene 7.26 + ortho/meta/para increments.
  if (mol.isAromaticAtom(a)) {
    let shift = 7.26;
    const dist = aromaticPositions(mol, a);
    for (let b = 0; b < mol.getAllAtoms(); b++) {
      if (!mol.isAromaticAtom(b)) continue;
      const d = dist[b];
      if (d < 1 || d > 3) continue;
      for (const s of aromaticSubstituents(mol, b)) {
        const key = classifySubstituent(mol, s, b);
        const inc = AR1H[key];
        if (!inc) continue;
        shift += inc[d - 1];
      }
    }
    aromaticCaveats(mol, a, dist, caveats);
    return { shift, assignment: "aromatic CH" };
  }

  // Alkene H.
  const dbl = nbrs.find((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 6);
  if (dbl) {
    let shift = 5.25;
    for (const nb of nbrs) {
      if (nb.atom === dbl.atom) continue;
      const key = classifySubstituent(mol, nb.atom, a);
      if (key === "Ph") shift += 1.35;
      else if (key === "OR" || key === "OH") shift += 1.2;
      else if (key === "CHO" || key === "COR" || key === "COOH" || key === "COOR") shift += 1.1;
    }
    return { shift, assignment: "=CH (alkene)" };
  }

  // Terminal alkyne H.
  if (nbrs.some((nb) => nb.order === 3)) return { shift: 2.4, assignment: "≡CH (alkyne)" };

  // sp3 CH3 / CH2 / CH — Shoolery-type additivity.
  const base = hCount === 3 ? 0.87 : hCount === 2 ? 1.2 : 1.55;
  let shift = base;
  let alphaCount = 0;
  for (const nb of nbrs) {
    const key = classifySubstituent(mol, nb.atom, a);
    const inc = SP3_1H[key];
    if (inc !== undefined) {
      shift += inc;
      alphaCount++;
    }
  }
  // β effects: substituents on the adjacent SKELETON carbon only. Walking into
  // a neighbour that is itself the α substituent (an aryl ipso carbon, a
  // carbonyl) would re-count that group's own atoms on top of its α increment.
  for (const nb of nbrs) {
    if (!isPlainAlkylCarbon(mol, nb.atom)) continue;
    for (const nb2 of neighbors(mol, nb.atom)) {
      if (nb2.atom === a) continue;
      const key = classifySubstituent(mol, nb2.atom, nb.atom);
      const inc = BETA_1H[key];
      if (inc !== undefined) shift += inc;
    }
  }
  if (alphaCount >= 3) {
    caveats.add(
      "A carbon bears 3+ electron-withdrawing substituents; Shoolery additivity over-counts here (e.g. CHCl3 predicts high)."
    );
  }

  const label = hCount === 3 ? "CH3" : hCount === 2 ? "CH2" : "CH";
  const on = nbrs
    .map((nb) => classifySubstituent(mol, nb.atom, a))
    .filter((k) => k !== "CH3" && k !== "alkyl" && k !== "other");
  return { shift, assignment: on.length ? `${label} (on ${on[0]})` : label };
}

/** Nominal ranges for exchangeable protons — genuinely variable, not predicted. */
function heteroatomProton(mol: Molecule, a: number): { shift: number; assignment: string } | null {
  const z = mol.getAtomicNo(a);
  const h = mol.getAllHydrogens(a);
  if (h < 1) return null;
  if (z === 8) {
    const c = neighbors(mol, a)[0];
    if (c && isCarbonyl(mol, c.atom)) return { shift: 11.5, assignment: "COOH (variable, 10-13)" };
    if (c && mol.isAromaticAtom(c.atom)) return { shift: 5.0, assignment: "phenol OH (variable, 4-8)" };
    return { shift: 2.0, assignment: "OH (variable, 1-5)" };
  }
  if (z === 7) {
    if (neighbors(mol, a).some((nb) => isCarbonyl(mol, nb.atom)))
      return { shift: 6.5, assignment: "amide NH (variable, 5-9)" };
    return { shift: 1.5, assignment: "NH (variable, 1-5)" };
  }
  if (z === 16) return { shift: 1.5, assignment: "SH (variable, 1-2)" };
  return null;
}

const MULT_NAMES = ["s", "d", "t", "q", "quint", "sext", "sept"];

/**
 * Multiplicity from the n+1 rule, counting protons on adjacent carbons. Returns
 * "m" when the coupling partners are inequivalent (the n+1 rule does not apply).
 */
function multiplicity(mol: Molecule, a: number): string {
  mol.ensureHelperArrays(Molecule.cHelperSymmetrySimple);
  const selfRank = mol.getSymmetryRank(a);
  const partners: number[] = [];
  const ranks = new Set<number>();
  for (const nb of neighbors(mol, a)) {
    if (mol.getAtomicNo(nb.atom) !== 6) continue; // ignore exchangeable OH/NH coupling
    const h = mol.getAllHydrogens(nb.atom);
    if (h === 0) continue;
    // Protons equivalent to these ones do not split them — coupling between
    // magnetically equivalent nuclei is not observable. Without this, benzene
    // (all six H equivalent) would be reported as a triplet instead of the
    // singlet it actually is.
    if (mol.getSymmetryRank(nb.atom) === selfRank) continue;
    partners.push(h);
    ranks.add(mol.getSymmetryRank(nb.atom));
  }
  const total = partners.reduce((s, x) => s + x, 0);
  if (total === 0) return "s";
  if (ranks.size > 1) return "m"; // inequivalent partners → not first-order n+1
  if (total < MULT_NAMES.length) return MULT_NAMES[total];
  return "m";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Predicts a 1H or 13C spectrum. Returns null when the input cannot be resolved
 * to a structure. Signals are sorted downfield-first, as a spectrum is read.
 */
export function predictNmr(input: string, nucleus: Nucleus): NmrResult | null {
  const parsed = parseToMolecule(input);
  if (!parsed) return null;
  const { mol, smiles } = parsed;
  const caveats = new Set<string>();
  const n = mol.getAllAtoms();

  if (nucleus === "13C") {
    const carbons: number[] = [];
    for (let a = 0; a < n; a++) if (mol.getAtomicNo(a) === 6) carbons.push(a);
    if (!carbons.length) return { smiles, nucleus, signals: [], caveats: [] };

    const signals: NmrSignal[] = [];
    for (const group of symmetryClasses(mol, carbons)) {
      const rep = group[0];
      const { shift, assignment } = shift13C(mol, rep, caveats);
      signals.push({
        shift,
        count: group.length,
        multiplicity: "s", // proton-decoupled, the standard 13C experiment
        assignment,
        atoms: group,
      });
    }
    signals.sort((x, y) => y.shift - x.shift);
    return { smiles, nucleus, signals, caveats: [...caveats] };
  }

  // 1H — one signal per symmetry class of proton-bearing heavy atom.
  const bearers: number[] = [];
  for (let a = 0; a < n; a++) if (mol.getAllHydrogens(a) > 0) bearers.push(a);
  if (!bearers.length) return { smiles, nucleus, signals: [], caveats: [] };

  const signals: NmrSignal[] = [];
  for (const group of symmetryClasses(mol, bearers)) {
    const rep = group[0];
    const hPer = mol.getAllHydrogens(rep);
    const count = hPer * group.length;
    if (mol.getAtomicNo(rep) === 6) {
      const { shift, assignment } = shift1HonCarbon(mol, rep, caveats);
      signals.push({ shift, count, multiplicity: multiplicity(mol, rep), assignment, atoms: group });
    } else {
      const het = heteroatomProton(mol, rep);
      if (!het) continue;
      signals.push({
        shift: het.shift,
        count,
        multiplicity: "s (br)",
        assignment: het.assignment,
        atoms: group,
        variable: true,
      });
    }
  }
  signals.sort((x, y) => y.shift - x.shift);
  return { smiles, nucleus, signals, caveats: [...caveats] };
}

/**
 * Renders predicted signals as stick-spectrum series for buildPlotSvg. Each
 * signal becomes a vertical stick; 1H sticks are scaled by proton count, 13C
 * sticks are uniform (decoupled 13C intensities are not quantitative).
 */
export function nmrSticks(result: NmrResult): { x: number; y: number }[][] {
  const maxCount = Math.max(1, ...result.signals.map((s) => s.count));
  return result.signals.map((s) => {
    const h = result.nucleus === "1H" ? s.count / maxCount : 1;
    return [
      { x: s.shift, y: 0 },
      { x: s.shift, y: h },
    ];
  });
}
