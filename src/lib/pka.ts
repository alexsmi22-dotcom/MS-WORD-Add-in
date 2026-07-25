// pKa estimation from structure — a deterministic functional-group detector.
//
// IMPORTANT — honesty: this is NOT a compound-specific quantitative pKa
// prediction (that needs a QSAR/ML model). It recognizes ionizable functional
// groups from the molecular graph and reports the TYPICAL literature pKa for
// each group. Detection is exact (walks OpenChemLib's atom/bond graph, so an
// ester is never mistaken for a carboxylic acid, nor an amide for an amine); the
// pKa *values* are representative group averages, and the UI must label them so.
//
// Values are widely-tabulated group averages (Perrin/CRC-style). Pure; offline.

import { Molecule } from "openchemlib";
import { lookupSmiles } from "./structures";
import { aromaticRingDistances, aromaticSubstituents, classifySubstituent, SubstKey } from "./molgraph";

export interface PkaSite {
  group: string;
  kind: "acid" | "base";
  /** Representative literature pKa. For a base this is the pKa of its conjugate acid (pKaH). */
  pka: number;
  /** How the value was derived, when a substituent correction was applied (for the UI to show). */
  note?: string;
}

// ---------------------------------------------------------------------------
// Substituent corrections — make the pKa compound-specific instead of a flat
// group average. Aromatic groups use the Hammett equation pKa = pKa0 − ρ·Σσ over
// the ring's meta/para substituents (ortho is excluded — Hammett is unreliable
// there). Aliphatic acids get an inductive α-substituent correction.
//
// σ constants are the standard Hansch–Leo values; σp⁻ (enhanced para) is used for
// resonance-withdrawing groups on phenol/aniline. ρ and pKa0 are the classic
// reaction constants (benzoic 4.20/1.00, phenol 9.99/2.23, anilinium 4.60/2.89).
// ---------------------------------------------------------------------------

const SIGMA: Partial<Record<SubstKey, { m: number; p: number; pMinus?: number }>> = {
  CH3: { m: -0.07, p: -0.17 },
  alkyl: { m: -0.07, p: -0.15 },
  OH: { m: 0.12, p: -0.37 },
  OR: { m: 0.12, p: -0.27 },
  OAc: { m: 0.39, p: 0.31 },
  NH2: { m: -0.16, p: -0.66 },
  NR2: { m: -0.21, p: -0.83 },
  NHAc: { m: 0.21, p: 0.0 },
  NO2: { m: 0.71, p: 0.78, pMinus: 1.27 },
  CN: { m: 0.56, p: 0.66, pMinus: 1.0 },
  CHO: { m: 0.35, p: 0.42, pMinus: 1.03 },
  COR: { m: 0.38, p: 0.5, pMinus: 0.84 },
  COOH: { m: 0.37, p: 0.45, pMinus: 0.73 },
  COOR: { m: 0.37, p: 0.45, pMinus: 0.74 },
  CONH2: { m: 0.28, p: 0.36, pMinus: 0.61 },
  F: { m: 0.34, p: 0.06 },
  Cl: { m: 0.37, p: 0.23 },
  Br: { m: 0.39, p: 0.23 },
  I: { m: 0.35, p: 0.18 },
  SH: { m: 0.25, p: 0.15 },
  SR: { m: 0.15, p: 0.0 },
  Ph: { m: 0.06, p: -0.01 },
  vinyl: { m: 0.05, p: -0.02 },
  alkynyl: { m: 0.21, p: 0.23 },
};

const HAMMETT: Record<"phenol" | "benzoic" | "anilinium", { pka0: number; rho: number; minus: boolean }> = {
  phenol: { pka0: 9.99, rho: 2.23, minus: true },
  benzoic: { pka0: 4.2, rho: 1.0, minus: false },
  anilinium: { pka0: 4.6, rho: 2.89, minus: true },
};

/**
 * Applies the Hammett correction for an ionizable group attached to the aromatic
 * ring at `ipso`. Returns the corrected pKa and a human-readable derivation.
 */
function hammettAdjust(mol: Molecule, ipso: number, kind: keyof typeof HAMMETT): { pka: number; note: string } {
  const p = HAMMETT[kind];
  const dist = aromaticRingDistances(mol, ipso);
  let sum = 0;
  const parts: string[] = [];
  let ortho = 0;
  for (let b = 0; b < mol.getAllAtoms(); b++) {
    const d = dist[b];
    if (d < 1 || d > 3) continue;
    for (const s of aromaticSubstituents(mol, b)) {
      const key = classifySubstituent(mol, s, b);
      const sig = SIGMA[key];
      if (!sig) continue;
      if (d === 1) { ortho++; continue; } // ortho excluded
      const v = d === 3 ? (p.minus && sig.pMinus !== undefined ? sig.pMinus : sig.p) : sig.m;
      sum += v;
      parts.push(`${key} ${d === 3 ? "para" : "meta"} σ=${v >= 0 ? "+" : ""}${v.toFixed(2)}`);
    }
  }
  const pka = Math.round((p.pka0 - p.rho * sum) * 100) / 100;
  let note = `parent ${p.pka0.toFixed(2)}`;
  if (parts.length) note += `; Hammett ρ=${p.rho}, Σσ=${sum >= 0 ? "+" : ""}${sum.toFixed(2)} [${parts.join(", ")}]`;
  else note += "; no meta/para substituents";
  if (ortho) note += `; ${ortho} ortho substituent(s) excluded`;
  return { pka, note };
}

// Inductive shift on an aliphatic carboxylic acid per electron-withdrawing group
// on the α-carbon (relative to acetic acid, pKa 4.76). Multiple groups attenuate.
const ALPHA_SHIFT: Partial<Record<SubstKey, number>> = {
  F: -2.2, Cl: -1.9, Br: -1.9, I: -1.7, CN: -2.3, NO2: -3.1,
  OH: -0.9, OR: -0.9, OAc: -0.9, COOH: -0.8, COOR: -0.8, Ph: -0.6, SR: -0.5,
};

/** Aliphatic carboxylic-acid pKa: acetic 4.76 with α-substituent inductive corrections. */
function aliphaticAcidPka(mol: Molecule, carbonylC: number): { pka: number; note: string } {
  const base = 4.76;
  // The α-carbon is the single-bonded carbon neighbour of the carbonyl (the R).
  let alpha = -1;
  const n = mol.getConnAtoms(carbonylC);
  for (let i = 0; i < n; i++) {
    const nb = mol.getConnAtom(carbonylC, i);
    if (mol.getConnBondOrder(carbonylC, i) === 1 && mol.getAtomicNo(nb) === 6) { alpha = nb; break; }
  }
  if (alpha < 0) return { pka: base, note: `parent 4.76` };
  const shifts: number[] = [];
  const parts: string[] = [];
  const na = mol.getConnAtoms(alpha);
  for (let i = 0; i < na; i++) {
    const s = mol.getConnAtom(alpha, i);
    if (s === carbonylC) continue;
    const key = classifySubstituent(mol, s, alpha);
    const sh = ALPHA_SHIFT[key];
    if (sh === undefined) continue;
    shifts.push(sh);
    parts.push(`${key} ${sh.toFixed(1)}`);
  }
  // Successive groups attenuate (each further one contributes ~0.82×).
  shifts.sort((a, b) => a - b);
  let total = 0;
  shifts.forEach((sh, i) => (total += sh * Math.pow(0.82, i)));
  const pka = Math.round((base + total) * 100) / 100;
  const note = parts.length ? `parent 4.76; α-inductive [${parts.join(", ")}]` : `parent 4.76`;
  return { pka, note };
}

/** The aromatic-carbon neighbour of `atom` (the ipso for a ring-attached group), or -1. */
function aromaticNeighbor(mol: Molecule, atom: number): number {
  const n = mol.getConnAtoms(atom);
  for (let i = 0; i < n; i++) {
    const nb = mol.getConnAtom(atom, i);
    if (mol.getAtomicNo(nb) === 6 && mol.isAromaticAtom(nb)) return nb;
  }
  return -1;
}

export interface PkaResult {
  smiles: string;
  sites: PkaSite[];
  /** Estimated net charge at pH 7.4 (Henderson–Hasselbalch per site). */
  netChargeAt74: number;
}

interface Neighbor {
  atom: number;
  order: number;
  /** Bond index — needed to tell a ring bond from a bond BETWEEN two rings. */
  bond: number;
}

function neighbors(mol: Molecule, a: number): Neighbor[] {
  const out: Neighbor[] = [];
  const n = mol.getConnAtoms(a);
  for (let i = 0; i < n; i++) {
    out.push({ atom: mol.getConnAtom(a, i), order: mol.getConnBondOrder(a, i), bond: mol.getConnBond(a, i) });
  }
  return out;
}

/** True if carbon `c` bears a double-bonded oxygen (a carbonyl). */
function isCarbonyl(mol: Molecule, c: number): boolean {
  if (mol.getAtomicNo(c) !== 6) return false;
  return neighbors(mol, c).some((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 8);
}

/**
 * A guanidine/amidine carbon: sp2 carbon with one C=N and one or two further
 * single-bonded nitrogens.
 *
 * These MUST be recognised as one group, not as their individual nitrogens.
 * Arginine's guanidine has three N: the =N is skipped as an imine, and the other
 * two each fall through to "aliphatic amine". That reported arginine as THREE
 * amines at 10.6 and gave a net charge of +2.0 at pH 7.4 — the real answer is
 * one guanidinium at ~12.5 and +1.0. Guanidine is the most basic group in
 * biochemistry; getting it wrong is not a rounding error.
 *
 * Returns the nitrogens belonging to the group, or null if `c` isn't one.
 */
function guanidineNitrogens(mol: Molecule, c: number): { ns: number[]; kind: "guanidine" | "amidine" } | null {
  if (mol.getAtomicNo(c) !== 6 || mol.isAromaticAtom(c)) return null;
  const nbrs = neighbors(mol, c);
  const dblN = nbrs.filter((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 7);
  if (dblN.length !== 1) return null;
  const sglN = nbrs.filter((nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 7);
  if (!sglN.length) return null;
  // A nitrogen that is itself an amide N belongs to the amide, not here — this
  // keeps acylguanidines and ureas from being misread.
  if (dblN.some((nb) => isCarbonyl(mol, nb.atom))) return null;
  const ns = [dblN[0].atom, ...sglN.map((nb) => nb.atom)];
  // Three nitrogens = guanidine (arginine, ~12.5). Two = amidine (~11.6).
  return { ns, kind: sglN.length >= 2 ? "guanidine" : "amidine" };
}

/** The atoms of the aromatic ring `a` belongs to, walking only same-size ring atoms. */
function aromaticRing(mol: Molecule, a: number, size: number): number[] {
  if (!mol.isAromaticAtom(a) || !mol.isRingAtom(a) || mol.getAtomRingSize(a) !== size) return [];
  const seen = new Set<number>([a]);
  const stack = [a];
  while (stack.length) {
    const x = stack.pop() as number;
    for (const nb of neighbors(mol, x)) {
      if (seen.has(nb.atom)) continue;
      if (!mol.isAromaticAtom(nb.atom) || !mol.isRingAtom(nb.atom)) continue;
      if (mol.getAtomRingSize(nb.atom) !== size) continue;
      seen.add(nb.atom);
      stack.push(nb.atom);
    }
  }
  return seen.size === size ? [...seen] : [];
}

/**
 * A tetrazole ring: five-membered aromatic with FOUR nitrogens.
 *
 * Tetrazole is ACIDIC (~4.9) — it is the standard carboxylic-acid bioisostere, in
 * losartan, valsartan, candesartan and much of med-chem. It was being read as three
 * separate "pyridine-type" aromatic nitrogens at pKa 5.2 each, i.e. as a WEAK BASE,
 * giving a net charge of +0.02 at pH 7.4 when the truth is about -1 (a tetrazole is
 * ~99.7% deprotonated there). A full charge unit, in the wrong direction.
 *
 * Returns the ring atoms, or null.
 */
function tetrazoleRing(mol: Molecule, a: number): number[] | null {
  const ring = aromaticRing(mol, a, 5);
  if (!ring.length) return null;
  const n = ring.filter((x) => mol.getAtomicNo(x) === 7).length;
  return n === 4 ? ring : null;
}

/**
 * A sulfonamide nitrogen: N single-bonded to an S that carries two double-bonded
 * oxygens.
 *
 * A sulfonamide N-H is ACIDIC (~10), not basic — the sulfonyl group withdraws so
 * strongly that the nitrogen's lone pair is unavailable. It was falling through to
 * "aliphatic amine" at pKa 10.6 and being counted as a BASE, which reported
 * benzenesulfonamide at net charge +1.00 at pH 7.4 when it is essentially neutral.
 * Sign error on a group present in a large share of marketed drugs.
 */
function isSulfonamideN(mol: Molecule, a: number): boolean {
  if (mol.getAtomicNo(a) !== 7) return false;
  for (const nb of neighbors(mol, a)) {
    if (nb.order !== 1 || mol.getAtomicNo(nb.atom) !== 16) continue;
    const doubleO = neighbors(mol, nb.atom).filter((x) => x.order === 2 && mol.getAtomicNo(x.atom) === 8).length;
    if (doubleO >= 2) return true;
  }
  return false;
}

/**
 * A hydroxamic acid: C(=O)-N-OH. Acidic ~9 (vorinostat/SAHA is one). Both its N
 * and its O were previously invisible — the N is an amide N (skipped, correctly)
 * and the O hangs off nitrogen rather than carbon, so the alcohol/phenol branch
 * never saw it. Result: no site at all.
 *
 * Returns the acidic OH oxygen, or -1.
 */
function hydroxamicOxygen(mol: Molecule, a: number): number {
  // a is the N.
  if (mol.getAtomicNo(a) !== 7) return -1;
  const onCarbonyl = neighbors(mol, a).some((nb) => nb.order === 1 && isCarbonyl(mol, nb.atom));
  if (!onCarbonyl) return -1;
  for (const nb of neighbors(mol, a)) {
    if (nb.order !== 1 || mol.getAtomicNo(nb.atom) !== 8) continue;
    if (mol.getAllHydrogens(nb.atom) >= 1 && mol.getConnAtoms(nb.atom) === 1) return nb.atom;
  }
  return -1;
}

/**
 * A barbiturate ring: six-membered, two N, three C=O.
 *
 * Two very different pKa values depending on C5:
 *   - barbituric acid itself (C5 bears H): the C5-H sits between two carbonyls and
 *     is acidic at ~4.0 — essentially fully ionised at pH 7.4 (net -1).
 *   - 5,5-disubstituted (phenobarbital and every clinical barbiturate): no C5-H, so
 *     the acidic proton is an N-H at ~7.6.
 * Neither was detected at all: the ring is all amide/imide nitrogens, which the
 * amide branch skips, so barbituric acid reported net 0.00 against a true -1.
 */
function barbiturateSite(mol: Molecule, ringAtom: number): { pka: number; group: string; ring: number[] } | null {
  if (!mol.isRingAtom(ringAtom) || mol.getAtomRingSize(ringAtom) !== 6) return null;
  // Walk only RING BONDS. Walking "any neighbour that is a ring atom of size 6"
  // leaks between rings: phenobarbital's C5 carries a phenyl, which is also a
  // size-6 ring, so the walk collected 12 atoms and the size check rejected the
  // whole molecule — phenobarbital reported no ionizable site at all. The bond
  // JOINING two rings is not itself a ring bond, which is exactly the boundary.
  const seen = new Set<number>([ringAtom]);
  const stack = [ringAtom];
  while (stack.length) {
    const x = stack.pop() as number;
    for (const nb of neighbors(mol, x)) {
      if (seen.has(nb.atom) || !mol.isRingBond(nb.bond)) continue;
      if (!mol.isRingAtom(nb.atom) || mol.getAtomRingSize(nb.atom) !== 6) continue;
      seen.add(nb.atom);
      stack.push(nb.atom);
    }
  }
  if (seen.size !== 6) return null;
  const ring = [...seen];
  const nitrogens = ring.filter((x) => mol.getAtomicNo(x) === 7);
  if (nitrogens.length !== 2) return null;
  const carbonyls = ring.filter((x) => mol.getAtomicNo(x) === 6 && isCarbonyl(mol, x));
  if (carbonyls.length !== 3) return null;
  // C5: the ring carbon that is NOT a carbonyl.
  const c5 = ring.find((x) => mol.getAtomicNo(x) === 6 && !isCarbonyl(mol, x));
  if (c5 === undefined) return null;
  return mol.getAllHydrogens(c5) >= 1
    ? { pka: 4.0, group: "Barbiturate C5-H (between two carbonyls)", ring }
    : { pka: 7.6, group: "Barbiturate N-H (5,5-disubstituted)", ring };
}

/**
 * True if aromatic nitrogen `a` sits in an imidazole — a five-membered aromatic
 * ring with exactly two nitrogens.
 */
function isImidazoleN(mol: Molecule, a: number): boolean {
  if (!mol.isAromaticAtom(a) || mol.getAtomicNo(a) !== 7) return false;
  if (!mol.isRingAtom(a) || mol.getAtomRingSize(a) !== 5) return false;
  // Walk the aromatic ring this atom belongs to and count its nitrogens.
  const seen = new Set<number>([a]);
  const stack = [a];
  let nCount = 0;
  while (stack.length) {
    const x = stack.pop() as number;
    if (mol.getAtomicNo(x) === 7) nCount++;
    for (const nb of neighbors(mol, x)) {
      if (seen.has(nb.atom)) continue;
      if (!mol.isAromaticAtom(nb.atom) || !mol.isRingAtom(nb.atom)) continue;
      if (mol.getAtomRingSize(nb.atom) !== 5) continue;
      seen.add(nb.atom);
      stack.push(nb.atom);
    }
  }
  return seen.size === 5 && nCount === 2;
}

/**
 * Detects ionizable groups and returns their representative pKa values. Returns
 * null if the input can't be resolved to a structure.
 */
export function predictPka(input: string): PkaResult | null {
  const looked = lookupSmiles(input);
  const raw = looked ? looked.smiles : input.trim();
  if (!raw) return null;
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(raw);
  } catch {
    return null;
  }
  const n = mol.getAllAtoms();
  if (n === 0) return null;
  mol.ensureHelperArrays(Molecule.cHelperRings);

  const sites: PkaSite[] = [];
  let smiles = raw;
  try {
    smiles = mol.toIsomericSmiles();
  } catch {
    /* keep raw */
  }

  // --- Pass 1: whole-group bases, before the per-atom walk -----------------
  // Guanidine and amidine must be claimed as ONE group. Left to the per-atom
  // loop, each of their nitrogens is separately mislabelled an "aliphatic
  // amine" — which reported arginine as three amines at 10.6 and a net charge
  // of +2.0 at pH 7.4, against a true +1.0.
  const consumedN = new Set<number>();
  const consumedO = new Set<number>();
  for (let c = 0; c < n; c++) {
    if (mol.getAtomCharge(c) !== 0) continue;
    const g = guanidineNitrogens(mol, c);
    if (!g) continue;
    if (g.ns.some((x) => consumedN.has(x))) continue; // already part of a group
    for (const x of g.ns) consumedN.add(x);
    sites.push(
      g.kind === "guanidine"
        ? { group: "Guanidine (arginine-type)", kind: "base", pka: 12.5 }
        : { group: "Amidine", kind: "base", pka: 11.6 }
    );
  }

  // --- Pass 1b: rings and groups whose pKa belongs to the WHOLE group ---------

  // Tetrazole: acidic ~4.9, not three weakly basic pyridine nitrogens.
  const consumedRing = new Set<number>();
  for (let a = 0; a < n; a++) {
    if (consumedRing.has(a)) continue;
    const ring = tetrazoleRing(mol, a);
    if (!ring) continue;
    for (const x of ring) { consumedRing.add(x); if (mol.getAtomicNo(x) === 7) consumedN.add(x); }
    sites.push({ group: "Tetrazole (carboxylic-acid bioisostere)", kind: "acid", pka: 4.9 });
  }

  // Barbiturate: the ring's nitrogens are imides the amide branch skips entirely.
  const seenBarb = new Set<number>();
  for (let a = 0; a < n; a++) {
    if (seenBarb.has(a) || mol.getAtomicNo(a) !== 7) continue;
    const b = barbiturateSite(mol, a);
    if (!b) continue;
    // Mark only THIS ring, not every size-6 ring in the molecule.
    for (const x of b.ring) { seenBarb.add(x); if (mol.getAtomicNo(x) === 7) consumedN.add(x); }
    sites.push({ group: b.group, kind: "acid", pka: b.pka });
  }

  // Sulfonamide N: ACIDIC ~10. Claim it before the amine walk calls it a base.
  for (let a = 0; a < n; a++) {
    if (mol.getAtomicNo(a) !== 7 || consumedN.has(a) || mol.getAtomCharge(a) !== 0) continue;
    if (!isSulfonamideN(mol, a)) continue;
    consumedN.add(a);
    if (mol.getAllHydrogens(a) >= 1) sites.push({ group: "Sulfonamide N-H", kind: "acid", pka: 10.0 });
  }

  // Hydroxamic acid: the OH hangs off nitrogen, so the alcohol branch never sees it.
  for (let a = 0; a < n; a++) {
    if (mol.getAtomicNo(a) !== 7 || consumedN.has(a)) continue;
    const o = hydroxamicOxygen(mol, a);
    if (o < 0 || consumedO.has(o)) continue;
    consumedN.add(a);
    consumedO.add(o);
    sites.push({ group: "Hydroxamic acid", kind: "acid", pka: 9.0 });
  }

  // Phosphorus oxo-acids are POLYPROTIC and their successive pKa values differ by
  // ~5-6 units. Every -OH on a phosphorus was previously pushed as a separate site
  // at pKa 2.0, so methylphosphonic acid (真 2.4 and 8.0) reported net -2.00 at pH
  // 7.4 against a true ~-1.2: the second proton is barely ionised there, not fully.
  for (let p = 0; p < n; p++) {
    if (mol.getAtomicNo(p) !== 15) continue;
    const hydroxyls = neighbors(mol, p).filter(
      (nb) => nb.order === 1 && mol.getAtomicNo(nb.atom) === 8 && mol.getAllHydrogens(nb.atom) >= 1 && mol.getConnAtoms(nb.atom) === 1
    );
    if (!hydroxyls.length) continue;
    for (const nb of hydroxyls) consumedO.add(nb.atom);
    // An ESTER oxygen (P-O-C) means a phosphate monoester; a P-C bond means a
    // phosphonate. The two families have materially different first pKa values.
    const onCarbon = neighbors(mol, p).some((nb) => mol.getAtomicNo(nb.atom) === 6);
    const steps = onCarbon ? [2.4, 8.0] : [1.5, 6.3]; // phosphonic acid vs phosphate monoester
    const label = onCarbon ? "Phosphonic acid" : "Phosphate";
    hydroxyls.slice(0, 2).forEach((_, i) => {
      sites.push({ group: `${label} (pKa${i + 1})`, kind: "acid", pka: steps[i] });
    });
  }

  for (let a = 0; a < n; a++) {
    const z = mol.getAtomicNo(a);
    const nbrs = neighbors(mol, a);
    const hyd = mol.getAllHydrogens(a);
    const charge = mol.getAtomCharge(a);
    if (charge !== 0) continue; // an already-charged atom is not a neutral ionizable site

    // An oxygen already claimed by a whole-group pass (phosphorus oxo-acid,
    // hydroxamic acid) must not be counted a second time as an alcohol.
    if (z === 8 && consumedO.has(a)) continue;

    // --- Carboxylic acid: C(=O)-O(H), the -OH oxygen terminal ---------------
    if (z === 8 && hyd >= 1 && mol.getConnAtoms(a) === 1) {
      const c = nbrs[0].atom;
      if (mol.getAtomicNo(c) === 6 && nbrs[0].order === 1) {
        // Distinguish acid (carbon is a carbonyl) from phenol/alcohol.
        // Sulfur/phosphorus oxo-acids handled separately below.
        if (isCarbonyl(mol, c)) {
          const ipso = aromaticNeighbor(mol, c);
          if (ipso >= 0) {
            const { pka, note } = hammettAdjust(mol, ipso, "benzoic");
            sites.push({ group: "Benzoic acid (aromatic)", kind: "acid", pka, note });
          } else {
            const { pka, note } = aliphaticAcidPka(mol, c);
            sites.push({ group: "Carboxylic acid", kind: "acid", pka, note });
          }
          continue;
        }
        if (mol.isAromaticAtom(c)) {
          const { pka, note } = hammettAdjust(mol, c, "phenol");
          sites.push({ group: "Phenol", kind: "acid", pka, note });
          continue;
        }
        sites.push({ group: "Alcohol (very weak; ~non-ionizable in water)", kind: "acid", pka: 16.0 });
        continue;
      }
      // Oxo-acid -OH on S or P
      if (mol.getAtomicNo(c) === 16) {
        const doubleO = neighbors(mol, c).filter((nb) => nb.order === 2 && mol.getAtomicNo(nb.atom) === 8).length;
        if (doubleO >= 2) sites.push({ group: "Sulfonic acid", kind: "acid", pka: -1.5 });
        else sites.push({ group: "Sulfinic/sulfonic acid", kind: "acid", pka: 2.0 });
        continue;
      }
      // Phosphorus oxo-acids are handled as a whole group in the pre-pass above,
      // because their successive pKa values differ by ~5-6 units and pushing one
      // site per -OH at a single pKa mis-states the net charge.
      if (mol.getAtomicNo(c) === 15) continue;
    }

    // --- Thiol: S(H) on carbon ---------------------------------------------
    if (z === 16 && hyd >= 1 && mol.getConnAtoms(a) === 1 && mol.getAtomicNo(nbrs[0].atom) === 6) {
      sites.push({ group: "Thiol", kind: "acid", pka: 10.5 });
      continue;
    }

    // --- Nitrogen bases -----------------------------------------------------
    if (z === 7) {
      // A nitrogen already claimed by a guanidine/amidine group below is part of
      // that group, not an amine in its own right.
      if (consumedN.has(a)) continue;

      // A sulfonamide N is ACIDIC, never a base — the sulfonyl withdraws its lone
      // pair. Claimed in the pre-pass; skip it here so the amine branch below
      // cannot label it "aliphatic amine, pKa 10.6" and report a base.
      if (isSulfonamideN(mol, a)) continue;

      // Aromatic nitrogen: pyridine-type (no H, lone pair available) is basic;
      // pyrrole-type (bears an H) is not.
      if (mol.isAromaticAtom(a)) {
        if (hyd !== 0) continue;
        // Imidazole (histidine's side chain) is markedly more basic than
        // pyridine — pKaH ~6.0 vs ~5.2 — and it is THE physiologically
        // interesting one, being the only side chain that titrates near pH 7.
        sites.push(
          isImidazoleN(mol, a)
            ? { group: "Imidazole (histidine-type)", kind: "base", pka: 6.0 }
            : { group: "Aromatic N (pyridine-type)", kind: "base", pka: 5.2 }
        );
        continue;
      }
      // Skip imines/nitriles/nitro (any multiple bond from N) and amides.
      if (nbrs.some((nb) => nb.order >= 2)) continue;
      const amide = nbrs.some((nb) => isCarbonyl(mol, nb.atom));
      if (amide) continue; // amide N is not basic
      const ipso = aromaticNeighbor(mol, a);
      if (ipso >= 0) {
        const { pka, note } = hammettAdjust(mol, ipso, "anilinium");
        sites.push({ group: "Aniline (aromatic amine)", kind: "base", pka, note });
      } else {
        sites.push({ group: "Aliphatic amine", kind: "base", pka: 10.6 });
      }
      continue;
    }
  }

  // Net charge at pH 7.4 via Henderson–Hasselbalch on each site.
  const pH = 7.4;
  let net = 0;
  for (const s of sites) {
    if (s.kind === "acid") net -= 1 / (1 + Math.pow(10, s.pka - pH)); // fraction deprotonated
    else net += 1 / (1 + Math.pow(10, pH - s.pka)); // fraction protonated
  }
  return { smiles, sites, netChargeAt74: net };
}
