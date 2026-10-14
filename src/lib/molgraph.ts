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

/**
 * True if atom `a` has a carbon bonded to it, by any bond order.
 *
 * The predicate a "C-X" assignment actually needs. IR was adding a "C-Cl
 * stretch" on the strength of the chlorine ALONE, so sodium chloride — in the
 * dictionary as "sodium chloride", "salt" and "table salt" — came back with
 * exactly one predicted band, a C-Cl stretch it does not have and cannot have.
 * Same for hydrochloric acid and for hexafluorophosphate's "C-F stretch". A
 * bond to carbon is what makes the vibration a C-X vibration; the element on
 * its own says nothing.
 */
export function hasCarbonNeighbour(mol: Molecule, a: number): boolean {
  return neighbors(mol, a).some((nb) => mol.getAtomicNo(nb.atom) === 6);
}

/**
 * True if `a` carries two or more double bonds — a CUMULATED centre: O=C=O,
 * S=C=S, R-N=C=S, a ketene's central carbon, an allene's central carbon.
 *
 * Cumulated centres are not ordinary sp2 atoms and none of the sp2 increment
 * tables in this codebase apply to them. Their shifts sit tens to a hundred ppm
 * away from anything an alkene or C=N increment scheme would give — carbon
 * dioxide is ≈125 and carbon disulfide ≈193, and the generic sp2 fallback used
 * to answer 160.0 for both, with the same label and no caveat.
 *
 * Aromatic atoms are excluded: a Kekulé double bond inside a ring is not
 * cumulation.
 */
export function isCumulatedCentre(mol: Molecule, a: number): boolean {
  if (mol.isAromaticAtom(a)) return false;
  return neighbors(mol, a).filter((nb) => nb.order === 2).length >= 2;
}

/**
 * What a nitrogen triple-bonded to carbon IS, decided by the nitrogen's OTHER
 * partner:
 *
 *   nitrile      R-C≡N        no other partner
 *   isocyanide   R-N≡C        the other partner is carbon
 *   nitrileOxide R-C≡N⁺–O⁻    the other partner is oxygen
 *   other        anything else (N-silyl, N-metal, two partners ...)
 *
 * Returns null when `n` is not a nitrogen carrying a C≡N triple bond.
 *
 * Three of these four get a different spectroscopic answer: a nitrile's carbon
 * is ≈118 ppm / 2245 cm-1, an isocyanide's ≈158 ppm / 2150 cm-1, and a nitrile
 * oxide's C≡N stretch sits near 2290-2300 cm-1 with a carbon far upfield of a
 * nitrile's. The old test was "triple-bonded to carbon and has another
 * partner", which called every nitrile oxide an isocyanide because the partner's
 * ELEMENT was never read; the consumers then printed an isocyanide's values for
 * it. Shared here so IR and NMR cannot answer differently for one structure.
 */
export type TripleCNKind = "nitrile" | "isocyanide" | "nitrileOxide" | "other";

export function tripleCNKind(mol: Molecule, n: number): TripleCNKind | null {
  if (mol.getAtomicNo(n) !== 7) return null;
  const nbrs = neighbors(mol, n);
  if (!nbrs.some((nb) => nb.order === 3 && mol.getAtomicNo(nb.atom) === 6)) return null;
  const others = nbrs.filter((nb) => nb.order !== 3);
  if (others.length === 0) return "nitrile";
  if (others.length !== 1) return "other";
  const z = mol.getAtomicNo(others[0].atom);
  if (z === 6) return "isocyanide";
  if (z === 8) return "nitrileOxide";
  return "other";
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
  /**
   * C(=O)-O⁻: the carboxylate ANION. Not an ester and not an acid. The two O
   * atoms are equivalent by resonance, so there is no C=O band at all (IR shows
   * COO⁻ asymmetric ≈1550-1610 and symmetric ≈1400-1450 cm-1 instead of an
   * ester's 1740) and the carbon sits near an acid's shift, not an ester's.
   * Acetate, benzoate and every amino-acid zwitterion in the dictionary are
   * this; the acid/ester split used to read only the O-H count and called them
   * all "ester".
   */
  | "carboxylate"
  | "ester"
  | "amide"
  | "aldehyde"
  | "ketone"
  | "acidHalide"
  | "anhydride"
  | "carbonate"
  | "urea"
  | "carbamate"
  | "thioester"
  | "isocyanate";

/**
 * Classifies a carbonyl carbon, or returns null when it is not one THIS FUNCTION
 * CAN NAME.
 *
 * The null matters. This used to end in a bare `return "ketone"`, which made
 * "ketone" a catch-all for every acyl environment the branches above did not
 * recognise — the same shape as the arginine pKa bug, where a missing group class
 * was silently routed to a plausible-looking default. Measured, all of these were
 * reported as ketones and given a ketone's 1715 cm-1 IR band and 205 ppm 13C shift:
 *
 *   O=C=O      carbon dioxide   -> IR is really 2349 cm-1, 13C ~125 ppm
 *   CN=C=O     isocyanate       -> N=C=O stretch is really ~2270 cm-1
 *   CC(=O)SC   thioester        -> C=O is really ~1690 cm-1, 13C ~193 ppm
 *   O=C=C=C=O  carbon suboxide  -> two "ketones"
 *   CC(=O)[SiH3] acyl silane, CC(=O)[Se]C selenoester
 *
 * carbon dioxide is IN the compound dictionary (both as a name and as the formula
 * CO2), so "predict the IR of CO2" answered 1715 cm-1 — off by 634 — with the
 * label "C=O stretch (ketone)". Thioesters cover every acyl-CoA in metabolism.
 *
 * A wrong band is worse than no band: an absent prediction is visible, a confident
 * wrong one is not. So anything not positively identified now returns null and the
 * callers simply predict nothing for it.
 */
export function carbonylKind(mol: Molecule, c: number): CarbonylKind | null {
  if (!isCarbonyl(mol, c)) return null;
  const o = carbonylOxygen(mol, c);
  const rest = neighbors(mol, c).filter((nb) => nb.atom !== o);
  const hydrogens = mol.getAllHydrogens(c);

  // A carbonyl carbon carrying a SECOND multiple bond is a cumulene, not an acyl
  // compound: O=C=O, R-N=C=O, R2C=C=O, O=C=C=C=O. Their stretches sit hundreds of
  // wavenumbers away from any acyl C=O, so they must never reach the ketone branch.
  const cumulated = rest.filter((nb) => nb.order >= 2);
  if (cumulated.length) {
    const partner = cumulated[0].atom;
    // R-N=C=O is a real, common group with a distinctive band; name it.
    if (mol.getAtomicNo(partner) === 7) return "isocyanate";
    // CO2, ketenes, suboxide: not acyl chemistry. Say nothing rather than guess.
    return null;
  }

  // Single-bonded heteroatom partners decide the class.
  const singleO = rest.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 8);
  const singleN = rest.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 7);
  const singleS = rest.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 16);
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
    // Charge is read BEFORE the hydrogen count: an O⁻ carries no hydrogen, and
    // "no hydrogen" used to mean "ester". A carboxylate is its own class.
    if (mol.getAtomCharge(oAtom) < 0) return "carboxylate";
    return mol.getAllHydrogens(oAtom) >= 1 ? "acid" : "ester";
  }
  if (singleN.length === 1) return "amide";
  // C(=O)-S: thioester (or thioacid). Every acyl-CoA in metabolism is one, and its
  // C=O sits ~25 cm-1 below a ketone's — outside the ketone band's stated range.
  if (singleS.length === 1) return "thioester";
  if (hydrogens >= 1) return "aldehyde";

  // A ketone is C(=O) flanked by exactly two single-bonded CARBONS. Anything else
  // reaching here — acyl silane, selenoester, an acyl metal — is an environment
  // this function does not know, so it gets no name and no predicted band.
  const carbons = rest.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 6);
  if (rest.length === 2 && carbons.length === 2) return "ketone";
  return null;
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
  // An out-of-range start must not write past the array: `dist[99] = 0` on a
  // 3-atom molecule silently grew the result to 100 entries padded with holes
  // (`null` under JSON), and OpenChemLib answers getConnAtoms(99) with 0 rather
  // than throwing, so nothing downstream noticed. Every atom is unreachable.
  if (from < 0 || from >= n) return dist;
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
  // CHARGE-AWARE classes. The classifier used to ignore charge entirely, so a
  // phenoxide O⁻ was "OR", an anilinium NH₃⁺ was "NH2" and a trimethylanilinium
  // NMe₃⁺ was "NR2": a strongly WITHDRAWING cation given the strongest DONATING
  // increment in the table (wrong sign, ~10-20 ppm out at para). These keys
  // carry their own table entries where a published value exists and are named
  // and REFUSED by the consumers where none does — never mapped onto the neutral
  // parent's number.
  /** Phenoxide / alkoxide O⁻: donates far more strongly than OH. */
  | "O-"
  /** Ammonio NH₃⁺ (anilinium): withdrawing, σ-like. */
  | "NH3+"
  /** Fully alkylated ammonio NR₃⁺ (trimethylanilinium): withdrawing, σ-like. */
  | "NR3+"
  /** Carboxylate COO⁻. */
  | "COO-"
  /** An sp2 carbon whose double bond goes to NITROGEN: imine, amidine, oxime. */
  | "C=N"
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
  const charge = mol.getAtomCharge(atom);
  const nbrs = neighbors(mol, atom).filter((nb) => nb.atom !== from);

  if (z === 9) return "F";
  if (z === 17) return "Cl";
  if (z === 35) return "Br";
  if (z === 53) return "I";

  if (z === 8) {
    // Charge first: an O⁻ has no hydrogen and no second partner, and used to
    // fall through to "OR" (an ether — a much weaker donor than an oxide).
    if (charge < 0) return "O-";
    // An oxonium O⁺ is nothing in the tables.
    if (charge > 0) return "other";
    if (h >= 1) return "OH";
    // -O-C(=O)R is an acetoxy group; -O-C is an ether.
    if (nbrs.some((nb) => isCarbonyl(mol, nb.atom))) return "OAc";
    return "OR";
  }

  if (z === 16) {
    // A sulfonium S⁺ or thiolate S⁻ is not a thioether or a thiol.
    if (charge !== 0) return "other";
    // Oxidised sulfur is NOT a thioether. -SO3H, -SO2NH2, -SO2R and -S(=O)R are
    // strongly ELECTRON-WITHDRAWING, whereas -SR is weakly DONATING: the increments
    // differ in SIGN, not just magnitude. Returning "SR" for benzenesulfonic acid
    // (measured — it did) applied a donating increment to a withdrawing group and
    // pushed the predicted para shift the wrong way.
    if (nbrs.some((nb) => mol.getAtomicNo(nb.atom) === 8)) return "other";
    if (h >= 1) return "SH";
    // A thioether's other partner should be carbon; anything else is unknown.
    if (nbrs.every((nb) => mol.getAtomicNo(nb.atom) === 6)) return "SR";
    return "other";
  }

  if (z === 7) {
    // Nitro: N with two oxygens (charge-separated or pentavalent form).
    const oxy = nbrs.filter((nb) => mol.getAtomicNo(nb.atom) === 8).length;
    if (oxy >= 2) return "NO2";
    // Nitroso (-N=O) has exactly ONE oxygen and is strongly WITHDRAWING. It used to
    // fall through to "NR2" — a strongly DONATING dialkylamine. Opposite sign,
    // ~19 ppm out at the para position, with nothing on screen to say so.
    if (oxy === 1) return "other";
    // Any multiple bond from N means azide, imine, diazo, isocyanate — none of
    // which behave like an amine. Measured: phenyl azide and nitrosobenzene both
    // classified as "NR2".
    if (nbrs.some((nb) => nb.order >= 2)) return "other";
    // A CATIONIC nitrogen is an ammonio group, which WITHDRAWS; the amine keys
    // below all DONATE. Anilinium used to be "NH2" and trimethylanilinium "NR2".
    // "NH3+" is the fully protonated primary ammonium; "NR3+" is the fully
    // alkylated quaternary one. A partly alkylated ammonium (NH₂R⁺, NHR₂⁺) has
    // no separate table entry anywhere in this codebase and is "other", which
    // every consumer names rather than prices.
    if (charge > 0) {
      if (h >= 3) return "NH3+";
      if (h === 0 && nbrs.length >= 1 && nbrs.every((nb) => mol.getAtomicNo(nb.atom) === 6)) return "NR3+";
      return "other";
    }
    // An amide anion or other N⁻ is not an amine either.
    if (charge < 0) return "other";
    if (isAmideN(mol, atom)) return "NHAc";
    if (h >= 2) return "NH2";
    // A real amine's remaining partners are carbon.
    if (nbrs.every((nb) => mol.getAtomicNo(nb.atom) === 6)) return "NR2";
    return "other";
  }

  if (z === 6) {
    // Nitrile carbon: triple bond to N — but only a TRUE nitrile (terminal N).
    // A nitrile oxide's carbon (C≡N⁺–O⁻) is not in the CN row of any table.
    const tripleN = nbrs.find((nb) => nb.order === 3 && mol.getAtomicNo(nb.atom) === 7);
    if (tripleN) return tripleCNKind(mol, tripleN.atom) === "nitrile" ? "CN" : "other";
    if (nbrs.some((nb) => nb.order === 3 && mol.getAtomicNo(nb.atom) === 6)) return "alkynyl";
    if (mol.isAromaticAtom(atom)) return "Ph";

    const kind = carbonylKind(mol, atom);
    if (kind) {
      switch (kind) {
        case "aldehyde":
          return "CHO";
        case "acid":
          return "COOH";
        case "carboxylate":
          return "COO-";
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
    // An sp2 carbon doubly bonded to NITROGEN (imine, amidine, amidinium, oxime)
    // used to fall through to the sp3 branch and be called "alkyl" — a donating
    // class, for a group that withdraws. No benzene increment table in this
    // codebase carries a C=N row, so the key exists to be NAMED by consumers.
    if (nbrs.some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 7)) return "C=N";
    // sp3: methyl vs larger alkyl.
    if (h === 3) return "CH3";
    return "alkyl";
  }

  return "other";
}

/**
 * Display names for the substituent keys that exist to be REFUSED by name.
 *
 * The charge-aware keys and "C=N" have no entry in most of the consumers'
 * increment tables (none was found in a published table this codebase can
 * cite). A consumer that meets one must say which group it left out, in the
 * group's own name — "attached via O" does not tell a reader that a phenoxide
 * was ignored. Returns null for keys that are not of that kind.
 */
export function substKeyLabel(key: SubstKey): string | null {
  switch (key) {
    case "O-":
      return "O⁻ (phenoxide / alkoxide)";
    case "NH3+":
      return "NH₃⁺ (ammonio)";
    case "NR3+":
      return "NR₃⁺ (quaternary ammonio)";
    case "COO-":
      return "COO⁻ (carboxylate)";
    case "C=N":
      return "C=N (imine / amidine carbon)";
    default:
      return null;
  }
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
