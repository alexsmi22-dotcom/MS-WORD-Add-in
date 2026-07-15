// Shared molecular-graph analysis for the spectroscopy predictors (NMR, IR,
// UV-Vis, MS fragmentation). Pure graph walking over OpenChemLib's atom/bond
// arrays — no spectroscopy values live here, only exact structural facts.
//
// Keeping detection here (rather than in each predictor) means an ester is
// recognised identically whether it is being assigned a 13C shift, a C=O
// stretching frequency, or a fragmentation pathway.

import { Molecule } from "openchemlib";
import { lookupSmiles } from "./structures";

export interface Neighbor {
  atom: number;
  order: number;
  bond: number;
  aromatic: boolean;
}

/** Neighbours of atom `a` with bond order, bond index, and bond aromaticity. */
export function neighbors(mol: Molecule, a: number): Neighbor[] {
  const out: Neighbor[] = [];
  const n = mol.getConnAtoms(a);
  for (let i = 0; i < n; i++) {
    const bond = mol.getConnBond(a, i);
    out.push({
      atom: mol.getConnAtom(a, i),
      order: mol.getConnBondOrder(a, i),
      bond,
      aromatic: mol.isAromaticBond(bond),
    });
  }
  return out;
}

/** True if carbon `c` bears a double-bonded oxygen (a carbonyl carbon). */
export function isCarbonyl(mol: Molecule, c: number): boolean {
  if (mol.getAtomicNo(c) !== 6) return false;
  return neighbors(mol, c).some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 8);
}

/** The double-bonded oxygen of a carbonyl carbon, or -1. */
export function carbonylOxygen(mol: Molecule, c: number): number {
  for (const nb of neighbors(mol, c)) {
    if (nb.order === 2 && mol.getAtomicNo(nb.atom) === 8) return nb.atom;
  }
  return -1;
}

/** True if `n` is an amide nitrogen (single-bonded to a carbonyl carbon). */
export function isAmideN(mol: Molecule, n: number): boolean {
  if (mol.getAtomicNo(n) !== 7) return false;
  return neighbors(mol, n).some((nb) => nb.order === 1 && isCarbonyl(mol, nb.atom));
}

/**
 * Classifies a carbonyl carbon by what is attached to it. This single function
 * drives the C=O assignment for every predictor, so an ester and an amide never
 * diverge between modules.
 */
export type CarbonylKind =
  | "acid"
  | "ester"
  | "amide"
  | "aldehyde"
  | "ketone"
  | "acidHalide"
  | "anhydride"
  | "carbonate"
  | "urea"
  | "carbamate";

export function carbonylKind(mol: Molecule, c: number): CarbonylKind | null {
  if (!isCarbonyl(mol, c)) return null;
  const o = carbonylOxygen(mol, c);
  const rest = neighbors(mol, c).filter((nb) => nb.atom !== o);
  const hydrogens = mol.getAllHydrogens(c);

  // Single-bonded heteroatom partners decide the class.
  const singleO = rest.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 8);
  const singleN = rest.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 7);
  const halide = rest.filter((nb) => [9, 17, 35, 53].includes(mol.getAtomicNo(nb.atom)));

  if (singleO.length === 2) return "carbonate";
  if (singleN.length === 2) return "urea";
  if (singleO.length === 1 && singleN.length === 1) return "carbamate";
  if (halide.length === 1) return "acidHalide";

  if (singleO.length === 1) {
    const oAtom = singleO[0].atom;
    // -O- bridging to a second carbonyl is an anhydride, not an ester.
    const bridges = neighbors(mol, oAtom).some((nb) => nb.atom !== c && isCarbonyl(mol, nb.atom));
    if (bridges) return "anhydride";
    return mol.getAllHydrogens(oAtom) >= 1 ? "acid" : "ester";
  }
  if (singleN.length === 1) return "amide";
  if (hydrogens >= 1) return "aldehyde";
  return "ketone";
}

/**
 * True for a plain sp3 alkane carbon: carbon, non-aromatic, no multiple bonds
 * (so carbonyl, nitrile, alkene and alkyne carbons are all excluded).
 *
 * This is the boundary of the "alkane skeleton" for Grant-Paul additivity.
 * Grant-Paul counts skeleton carbons; every non-skeleton group is instead
 * accounted for by a substituent increment. Mixing the two double-counts the
 * group and throws the shift off by tens of ppm.
 */
export function isPlainAlkylCarbon(mol: Molecule, a: number): boolean {
  if (mol.getAtomicNo(a) !== 6) return false;
  if (mol.isAromaticAtom(a)) return false;
  return neighbors(mol, a).every((nb) => nb.order === 1);
}

/** True if the atom is conjugated to an aromatic ring or C=C (affects C=O and λmax). */
export function isConjugated(mol: Molecule, c: number): boolean {
  for (const nb of neighbors(mol, c)) {
    if (nb.order !== 1) continue;
    const z = mol.getAtomicNo(nb.atom);
    if (z !== 6) continue;
    if (mol.isAromaticAtom(nb.atom)) return true;
    // A C=C on the neighbour means an enone-type conjugation.
    const hasDoubleC = neighbors(mol, nb.atom).some(
      (x) => x.order === 2 && mol.getAtomicNo(x.atom) === 6 && x.atom !== c
    );
    if (hasDoubleC) return true;
  }
  return false;
}

/**
 * Graph distance from `from` to every atom, walking only atoms that satisfy
 * `allow` and (optionally) only bonds that satisfy `allowBond`. Unreachable
 * atoms get -1. Used for ring topology (ortho / meta / para) and for α/β/γ
 * substituent counting.
 */
export function distancesFrom(
  mol: Molecule,
  from: number,
  allow?: (a: number) => boolean,
  allowBond?: (nb: Neighbor, fromAtom: number) => boolean
): number[] {
  const n = mol.getAllAtoms();
  const dist = new Array<number>(n).fill(-1);
  if (allow && !allow(from)) return dist;
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const a = queue[head];
    for (const nb of neighbors(mol, a)) {
      if (dist[nb.atom] !== -1) continue;
      if (allow && !allow(nb.atom)) continue;
      if (allowBond && !allowBond(nb, a)) continue;
      dist[nb.atom] = dist[a] + 1;
      queue.push(nb.atom);
    }
  }
  return dist;
}

/**
 * Ring distances within ONE aromatic ring system: 1 = ortho, 2 = meta, 3 = para.
 *
 * Walks aromatic BONDS, not merely aromatic atoms. In biphenyl the inter-ring
 * bond is a plain single bond joining two aromatic atoms — an atom-only filter
 * would stroll across it and apply the far ring's substituent increments to this
 * ring, which is exactly what the increment tables do not mean.
 */
export function aromaticRingDistances(mol: Molecule, a: number): number[] {
  return distancesFrom(
    mol,
    a,
    (x) => mol.isAromaticAtom(x),
    (nb) => nb.aromatic
  );
}

/**
 * True if the aromatic system containing `a` is fused (shares atoms between
 * rings, as in naphthalene). A fusion carbon carries three aromatic bonds,
 * whereas every carbon of an isolated benzene ring carries exactly two.
 */
export function isFusedAromatic(mol: Molecule, a: number): boolean {
  if (!mol.isAromaticAtom(a)) return false;
  const dist = aromaticRingDistances(mol, a);
  for (let b = 0; b < mol.getAllAtoms(); b++) {
    if (dist[b] < 0) continue;
    const aromaticBonds = neighbors(mol, b).filter((nb) => nb.aromatic).length;
    if (aromaticBonds >= 3) return true;
  }
  return false;
}

/**
 * Substituents on an aromatic atom: neighbours reached by a NON-aromatic bond.
 * In biphenyl the inter-ring bond is a plain single bond, so each ring correctly
 * sees the other as a phenyl substituent.
 */
export function aromaticSubstituents(mol: Molecule, a: number): number[] {
  return neighbors(mol, a)
    .filter((nb) => !nb.aromatic)
    .map((nb) => nb.atom);
}

/**
 * A canonical key for a substituent, viewed from the atom it is attached to.
 * The keys line up with the published increment tables used by the predictors.
 */
export type SubstKey =
  | "CH3"
  | "alkyl"
  | "OH"
  | "OR"
  | "OAc"
  | "NH2"
  | "NR2"
  | "NHAc"
  | "NO2"
  | "CN"
  | "CHO"
  | "COR"
  | "COOH"
  | "COOR"
  | "CONH2"
  | "F"
  | "Cl"
  | "Br"
  | "I"
  | "SH"
  | "SR"
  | "Ph"
  | "vinyl"
  | "alkynyl"
  | "other";

/** Classifies the substituent rooted at `atom`, arriving from `from`. */
export function classifySubstituent(mol: Molecule, atom: number, from: number): SubstKey {
  const z = mol.getAtomicNo(atom);
  const h = mol.getAllHydrogens(atom);
  const nbrs = neighbors(mol, atom).filter((nb) => nb.atom !== from);

  if (z === 9) return "F";
  if (z === 17) return "Cl";
  if (z === 35) return "Br";
  if (z === 53) return "I";

  if (z === 8) {
    if (h >= 1) return "OH";
    // -O-C(=O)R is an acetoxy group; -O-C is an ether.
    if (nbrs.some((nb) => isCarbonyl(mol, nb.atom))) return "OAc";
    return "OR";
  }

  if (z === 16) {
    if (h >= 1) return "SH";
    return "SR";
  }

  if (z === 7) {
    // Nitro: N with two oxygens (charge-separated or pentavalent form).
    const oxy = nbrs.filter((nb) => mol.getAtomicNo(nb.atom) === 8).length;
    if (oxy >= 2) return "NO2";
    if (isAmideN(mol, atom)) return "NHAc";
    if (h >= 2) return "NH2";
    return "NR2";
  }

  if (z === 6) {
    // Nitrile carbon: triple bond to N.
    if (nbrs.some((nb) => nb.order === 3 && mol.getAtomicNo(nb.atom) === 7)) return "CN";
    if (nbrs.some((nb) => nb.order === 3 && mol.getAtomicNo(nb.atom) === 6)) return "alkynyl";
    if (mol.isAromaticAtom(atom)) return "Ph";

    const kind = carbonylKind(mol, atom);
    if (kind) {
      switch (kind) {
        case "aldehyde":
          return "CHO";
        case "acid":
          return "COOH";
        case "ester":
          return "COOR";
        case "amide":
          return "CONH2";
        default:
          return "COR";
      }
    }
    // Plain sp2 carbon (C=C) is a vinyl substituent.
    if (nbrs.some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 6)) return "vinyl";
    // sp3: methyl vs larger alkyl.
    if (h === 3) return "CH3";
    return "alkyl";
  }

  return "other";
}

/** Parses an input (dictionary name, formula-free SMILES, or SMILES) to a Molecule. */
export function parseToMolecule(input: string): { mol: Molecule; smiles: string } | null {
  const looked = lookupSmiles(input);
  const raw = looked ? looked.smiles : input.trim();
  if (!raw) return null;
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(raw);
  } catch {
    return null;
  }
  if (mol.getAllAtoms() === 0) return null;
  mol.ensureHelperArrays(Molecule.cHelperRings);
  let smiles = raw;
  try {
    smiles = mol.toIsomericSmiles();
  } catch {
    /* keep raw */
  }
  return { mol, smiles };
}

/**
 * Groups atoms into symmetry-equivalent classes using OpenChemLib's symmetry
 * ranks, so the six benzene carbons collapse to one NMR signal rather than six.
 */
export function symmetryClasses(mol: Molecule, atoms: number[]): number[][] {
  // cHelperSymmetrySimple is the constant that actually populates the rank
  // table; there is no `cHelperSymmetry` on the JS build (it reads as undefined
  // and every rank silently comes back as -1).
  mol.ensureHelperArrays(Molecule.cHelperSymmetrySimple);
  const byRank = new Map<number, number[]>();
  for (const a of atoms) {
    const rank = mol.getSymmetryRank(a);
    const cur = byRank.get(rank);
    if (cur) cur.push(a);
    else byRank.set(rank, [a]);
  }
  return [...byRank.values()];
}
